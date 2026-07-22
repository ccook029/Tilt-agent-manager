// ---------------------------------------------------------------------------
// web/change-engine.ts — turn a plain-language website change into a PR.
//
// Nova (the Website Manager) agrees a change with Chris in chat; this fetches
// the real file from the storefront repo, has Claude produce the SMALLEST
// correct edit as verbatim find/replace ops, applies them, and opens a PR for
// review. A human merges — nothing hits the live store unreviewed.
// ---------------------------------------------------------------------------
import { callClaude } from "../anthropic";
import { CLAUDE_MANAGER_MODEL } from "../models";
import {
  getFile,
  getBaseSha,
  createBranch,
  commitFile,
  openPr,
  websiteRepo,
  websiteRepoConfigured,
} from "./github";

export interface WebChangeResult {
  ok: boolean;
  prUrl?: string;
  summary?: string;
  error?: string;
}

const EDIT_SYSTEM = `You are a senior web engineer editing the Tilt Hockey storefront (a Next.js/TypeScript app). Make the SMALLEST correct change that satisfies the request, expressed as exact find/replace operations on the given file. Rules: each "find" must be a VERBATIM, UNIQUE substring copied from the file (include enough surrounding text to be unique); never reformat or touch unrelated code; preserve types and syntax. If the change doesn't belong in this file or can't be done safely, return no edits and say why.`;

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

    // 2) Ask Claude for the smallest correct edit.
    const res = await callClaude({
      systemPrompt: EDIT_SYSTEM,
      userMessage: editPrompt(path, content, input.request),
      model: CLAUDE_MANAGER_MODEL,
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

    // 4) Branch, commit, open the PR.
    const baseSha = await getBaseSha();
    const branch = `nova/${slug(input.title)}-${Date.now().toString(36)}`;
    await createBranch(branch, baseSha);
    await commitFile(path, next, `Nova: ${input.title}`, branch, sha);
    const prUrl = await openPr(
      input.title,
      branch,
      `${parsed?.summary ?? input.request}\n\n---\nRequested via the Website Manager (Nova) in Tilt HQ:\n\n> ${input.request}\n\nFile: \`${path}\` in \`${websiteRepo()}\`. Review and merge to ship.`
    );
    return { ok: true, prUrl, summary: parsed?.summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
