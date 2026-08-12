// ---------------------------------------------------------------------------
// web/auto-merge.ts — the decision to put a Nova change on the live store.
//
// One implementation, two callers: the chat card polls it through
// /api/web/merge, and the work-order ship executor calls it directly when Chris
// approves. Both must apply the SAME gates, so they share this rather than each
// keeping their own copy — the pattern that already bit us once today, when the
// typed and voice chats drifted.
//
// Two gates, both required, both re-derived from GitHub every call:
//   1. every file the PR touches is content/merchandising, and no diff in a
//      catalogue file moves a number (see ./policy)
//   2. CI on the PR head is green — "nothing reported yet" counts as not-ready
// ---------------------------------------------------------------------------
import { getChecks, getPr, listPrFiles, mergePr, websiteRepo } from "./github";
import { classifyPr } from "./policy";
import { postSignal } from "../signals";

export type MergeOutcome =
  | { status: "merged"; note: string }
  | { status: "pending"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "failed"; reason: string };

/**
 * Try to merge PR `prNumber`. Never throws — every failure mode is a status the
 * caller can show or retry. A "pending" is safe to call again in a moment.
 */
export async function tryAutoMerge(
  prNumber: number,
  title: string
): Promise<MergeOutcome> {
  try {
    const pr = await getPr(prNumber);
    if (pr.merged) return { status: "merged", note: "Already merged." };

    // Gate 1 — policy, from the PR's real files and diffs.
    const files = await listPrFiles(prNumber);
    const verdict = classifyPr(files);
    if (!verdict.autoMergeable) {
      return { status: "blocked", reason: verdict.reason ?? "Held for review." };
    }

    // Gate 2 — CI.
    const checks = await getChecks(pr.headSha);
    if (checks === "failing") {
      return {
        status: "failed",
        reason: "CI failed on this change — it will not be merged.",
      };
    }
    if (checks !== "passing") {
      return {
        status: "pending",
        reason:
          checks === "none"
            ? "Waiting for the build to start…"
            : "Waiting for the build to finish…",
      };
    }

    if (pr.mergeableState === "dirty" || pr.mergeableState === "blocked") {
      return {
        status: "blocked",
        reason:
          pr.mergeableState === "dirty"
            ? "The branch has conflicts with main."
            : "The base branch's protection rules won't allow this merge.",
      };
    }

    const merged = await mergePr(prNumber, title);
    if (!merged.merged) {
      return {
        status: "failed",
        reason: merged.message || "GitHub declined the merge.",
      };
    }

    await postSignal({
      source: "website",
      headline: `Nova shipped a website change — PR #${prNumber}`,
      detail:
        `${title}\n` +
        `Files: ${verdict.files.map((f) => f.path).join(", ")}\n` +
        `Repo: ${websiteRepo()}. Content/merchandising only, CI green.`,
    }).catch(() => {});

    return { status: "merged", note: "Live on the site." };
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Wait for CI and merge, for callers that can afford to block — the approve
 * trigger, where Chris has just clicked and expects the change to land.
 *
 * Gives up cleanly rather than hanging: on timeout the PR is simply left open,
 * which is the same safe state as any held change.
 */
export async function waitAndMerge(
  prNumber: number,
  title: string,
  opts: { timeoutMs?: number; pollMs?: number } = {}
): Promise<MergeOutcome> {
  const timeoutMs = opts.timeoutMs ?? 150_000;
  const pollMs = opts.pollMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const outcome = await tryAutoMerge(prNumber, title);
    if (outcome.status !== "pending") return outcome;
    if (Date.now() + pollMs >= deadline) {
      return {
        status: "pending",
        reason:
          "The build is still running — the PR is open and will need a merge once it goes green.",
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
