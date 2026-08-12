// ---------------------------------------------------------------------------
// web/change-engine.ts — turn a plain-language website change into a PR.
//
// Nova (the Website Manager) agrees a change with Chris in chat; this fetches
// the real file from the storefront repo, has Claude produce the SMALLEST
// correct edit as verbatim find/replace ops, applies them, and opens a PR for
// review. A human merges — nothing hits the live store unreviewed.
// ---------------------------------------------------------------------------
import { callClaudeToCompletion } from "../anthropic";
import { CLAUDE_MANAGER_MODEL } from "../models";
import { getEmployeeById } from "../org/directory";
import {
  getFile,
  getBaseSha,
  createBranch,
  commitFile,
  openPr,
  websiteRepo,
  websiteRepoConfigured,
} from "./github";
import { changesPrices, classifyPr } from "./policy";

export interface WebChangeResult {
  ok: boolean;
  prUrl?: string;
  prNumber?: number;
  summary?: string;
  error?: string;
  /**
   * Whether this change is one Nova may ship herself once CI is green (content
   * and merchandising), or one that waits for Chris. Decided by ./policy.ts and
   * re-checked server-side at merge time against the PR's real file list — this
   * flag is for the UI, never the authority.
   */
  autoMergeable?: boolean;
  /** When it isn't auto-mergeable, why — shown on the card. */
  holdReason?: string;
}

const EDIT_SYSTEM = `You are a senior web engineer editing the Tilt Hockey storefront (a Next.js/TypeScript app). Make the SMALLEST correct change that satisfies the request, expressed as exact find/replace operations on the given file. Rules: each "find" must be a VERBATIM, UNIQUE substring copied from the file (include enough surrounding text to be unique); never reformat or touch unrelated code; preserve types and syntax.

CUSTOMER-FACING PROSE IS DIFFERENT FROM CODE. When an edit removes or changes part of a sentence, list, or product description, "smallest" means the smallest change that leaves what REMAINS reading as clean, natural English — widen the find/replace to cover the whole affected sentence if that's what it takes. Removing ", or the striking Lazer edition" from "Choose from 18K Carbon, 24K Carbon, or the striking Lazer edition." must yield "Choose from 18K Carbon or 24K Carbon." — not a dangling "18K Carbon, 24K Carbon." A removal that leaves broken grammar, an orphaned comma, or a reference to something no longer offered is a WRONG edit even though it satisfies the letter of the request: real customers read this text.

If the change doesn't belong in this file or can't be done safely, return no edits and say why.`;

// The proofread that runs AFTER edits are applied, on the result. The minimal-
// edit rule above is a safety property for code, but it also means the engine
// faithfully reproduces whatever grammar the requester's instruction implies —
// so the result gets read back before it ships, the way a human would re-read
// a sentence they just cut a clause out of.
const POLISH_SYSTEM = `You are proofreading the Tilt Hockey storefront file AFTER a change was applied. Check ONLY the parts affected by that change: does every affected sentence, list, and description still read as correct, natural English for a customer? Is anything left referring to something the change removed? Ignore everything unrelated to the change. Reply in the same JSON find/replace format, with the same rules (each "find" a VERBATIM, UNIQUE substring of the file as given; smallest correct fix; never touch unrelated code). If it all reads clean, return { "edits": [], "summary": "reads clean" }.`;

/** Model for storefront edits and the read-back pass. This IS Nova working, so
 * it follows her directory entry (claude-opus-5 — one line in directory.ts
 * changes her brain everywhere). WEB_EDIT_MODEL in Vercel still wins as an
 * emergency override; the manager model is the last-resort fallback. */
function webEditModel(): string {
  return (
    process.env.WEB_EDIT_MODEL ||
    getEmployeeById("web-manager")?.model ||
    CLAUDE_MANAGER_MODEL
  );
}

function editPrompt(path: string, content: string, request: string): string {
  const shown = content.length > 60000 ? content.slice(0, 60000) : content;
  return `File: ${path}
${content.length > 60000 ? "(showing the first part of a large file)\n" : ""}
\`\`\`
${shown}
\`\`\`

Change request: ${request}

Return ONLY JSON:
\`\`\`json
{ "edits": [ { "find": "<verbatim unique substring>", "replace": "<replacement>" } ], "summary": "one line describing the change" }
\`\`\`
If it can't be done safely in this file, return { "edits": [], "summary": "why not" }.`;
}

function parseJson(text: string): { edits?: { find?: string; replace?: string }[]; summary?: string } | null {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(raw.slice(a, b + 1));
  } catch {
    return null;
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "change"
  );
}

export async function executeWebChange(input: {
  request: string;
  path: string;
  title: string;
}): Promise<WebChangeResult> {
  if (!websiteRepoConfigured()) {
    return {
      ok: false,
      error:
        "Website PRs aren't set up yet — add GITHUB_TOKEN (with contents + pull-request write on the storefront repo) to the hub's Vercel env.",
    };
  }
  const path = input.path.replace(/^\/+/, "").trim();
  if (!path) return { ok: false, error: "No target file specified." };

  try {
    // 1) Read the real file.
    const { content, sha } = await getFile(path);

    // 2) Ask Claude for the smallest correct edit. ToCompletion: a truncated
    // edits block would otherwise parse as "no edits" and fail confusingly.
    const res = await callClaudeToCompletion({
      systemPrompt: EDIT_SYSTEM,
      userMessage: editPrompt(path, content, input.request),
      model: webEditModel(),
      maxTokens: 4000,
      temperature: 0,
    });
    const parsed = parseJson(res.text);
    const edits = Array.isArray(parsed?.edits) ? parsed!.edits! : [];
    if (edits.length === 0) {
      return { ok: false, error: parsed?.summary || "Couldn't produce a safe edit for that file." };
    }

    // 3) Apply verbatim, unique find/replace ops to the full file.
    let next = content;
    for (const e of edits) {
      const find = String(e.find ?? "");
      const replace = String(e.replace ?? "");
      if (!find) return { ok: false, error: "Empty match in the proposed edit." };
      if (!next.includes(find)) {
        return {
          ok: false,
          error: `Couldn't find the text to change in ${path} — the file may have changed. Try describing it differently.`,
        };
      }
      if (next.indexOf(find) !== next.lastIndexOf(find)) {
        return {
          ok: false,
          error: `The text to change appears more than once in ${path}; the edit needs to be more specific.`,
        };
      }
      next = next.replace(find, replace);
    }
    if (next === content) return { ok: false, error: "The edit didn't change anything." };

    // 3b) Read the result back before it ships. Best-effort: a polish fix that
    // can't anchor verbatim-and-unique is dropped rather than failing the
    // change — the primary edit is already correct, this pass only tidies what
    // the cut left behind.
    let polishNote = "";
    try {
      const polishRes = await callClaudeToCompletion({
        systemPrompt: POLISH_SYSTEM,
        userMessage: `File: ${path} (AFTER the change was applied)
${next.length > 60000 ? "(showing the first part of a large file)\n" : ""}
\`\`\`
${next.length > 60000 ? next.slice(0, 60000) : next}
\`\`\`

The change that was just applied: ${input.request}

Return ONLY JSON:
\`\`\`json
{ "edits": [ { "find": "<verbatim unique substring>", "replace": "<replacement>" } ], "summary": "one line" }
\`\`\``,
        model: webEditModel(),
        maxTokens: 2000,
        temperature: 0,
      });
      const polish = parseJson(polishRes.text);
      for (const e of polish?.edits ?? []) {
        const find = String(e.find ?? "");
        const replace = String(e.replace ?? "");
        if (!find || !next.includes(find)) continue;
        if (next.indexOf(find) !== next.lastIndexOf(find)) continue;
        next = next.replace(find, replace);
        polishNote = " Read-back pass tidied the surrounding copy.";
      }
    } catch (err) {
      console.warn(
        "[change-engine] read-back pass failed (primary edit stands):",
        err instanceof Error ? err.message : err
      );
    }

    // 4) Branch, commit, open the PR.
    const baseSha = await getBaseSha();
    const branch = `nova/${slug(input.title)}-${Date.now().toString(36)}`;
    await createBranch(branch, baseSha);
    await commitFile(path, next, `Nova: ${input.title}`, branch, sha);
    // Predict the merge verdict from the edits we just applied, so the card
    // doesn't promise "this'll go live" and then get held at the gate. Shaped
    // as a patch (find = removed lines, replace = added) so the same money rule
    // runs here as at merge time. The merge endpoint re-checks against the real
    // diff regardless — this is the honest hint, not the decision.
    const pseudoPatch = edits
      .map(
        (e) =>
          `${String(e.find ?? "")
            .split("\n")
            .map((l) => `-${l}`)
            .join("\n")}\n${String(e.replace ?? "")
            .split("\n")
            .map((l) => `+${l}`)
            .join("\n")}`
      )
      .join("\n");
    const verdict = classifyPr([{ filename: path, patch: pseudoPatch }]);
    const priced = changesPrices([{ filename: path, patch: pseudoPatch }]);
    const pr = await openPr(
      input.title,
      branch,
      `${parsed?.summary ?? input.request}\n\n---\nRequested via the Website Manager (Nova) in Tilt HQ:\n\n> ${input.request}\n\nFile: \`${path}\` in \`${websiteRepo()}\`.\n\n${
        verdict.autoMergeable
          ? `Nova merges this herself once CI is green.${priced ? " **Includes a price change** — shipped on founder approval, labelled in the HQ signal." : ""}`
          : `Held for review — ${verdict.reason}.`
      }`
    );
    return {
      ok: true,
      prUrl: pr.url,
      prNumber: pr.number,
      summary: parsed?.summary,
      autoMergeable: verdict.autoMergeable,
      holdReason: verdict.autoMergeable ? undefined : verdict.reason,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
