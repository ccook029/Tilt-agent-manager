// ---------------------------------------------------------------------------
// POST /api/web/merge — Nova ships a content/merchandising change to the store.
//
// Body: { prNumber, title? }. Auth: Tilt OS middleware (founder console).
//
// This is the authority, not the chat card. Every call re-derives the policy
// verdict from the PR's REAL file list on GitHub, so a client that lies about
// what it's merging gets refused. Two gates, both required:
//
//   1. every changed file is content/merchandising (see lib/web/policy)
//   2. CI on the PR head is green — not pending, not absent
//
// Returns a status the caller can poll on: merged | pending | blocked | failed.
// Anything Nova ships posts a signal to HQ, so an unattended change to the live
// store is never something you find out about by noticing it.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  getChecks,
  getPr,
  listPrFiles,
  mergePr,
  websiteRepo,
  websiteRepoConfigured,
} from "@/lib/web/github";
import { classifyPr } from "@/lib/web/policy";
import { postSignal } from "@/lib/signals";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!websiteRepoConfigured()) {
    return NextResponse.json(
      { status: "failed", error: "GITHUB_TOKEN is not set." },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    prNumber?: number;
    title?: string;
  };
  const prNumber = Number(body.prNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return NextResponse.json(
      { status: "failed", error: "prNumber is required." },
      { status: 400 }
    );
  }

  try {
    const pr = await getPr(prNumber);
    if (pr.merged) {
      return NextResponse.json({ status: "merged", note: "Already merged." });
    }

    // Gate 1 — the policy, re-derived from what the PR actually changes: both
    // which files, and what the diffs do to them (an allowed file can still
    // move a price).
    const files = await listPrFiles(prNumber);
    const verdict = classifyPr(files);
    if (!verdict.autoMergeable) {
      return NextResponse.json({
        status: "blocked",
        reason: verdict.reason,
        files: verdict.files,
      });
    }

    // Gate 2 — CI. "none" (nothing reported yet) counts as not-ready, so a PR
    // can't slip through the window before the first check registers.
    const checks = await getChecks(pr.headSha);
    if (checks === "failing") {
      return NextResponse.json({
        status: "failed",
        reason: "CI failed on this change — it will not be merged.",
      });
    }
    if (checks !== "passing") {
      return NextResponse.json({
        status: "pending",
        reason:
          checks === "none"
            ? "Waiting for the build to start…"
            : "Waiting for the build to finish…",
      });
    }

    // GitHub's own last word — protected branches, conflicts.
    if (pr.mergeableState === "dirty" || pr.mergeableState === "blocked") {
      return NextResponse.json({
        status: "blocked",
        reason:
          pr.mergeableState === "dirty"
            ? "The branch has conflicts with main."
            : "The base branch's protection rules won't allow this merge.",
      });
    }

    const merged = await mergePr(prNumber, body.title?.trim() || `Nova: PR #${prNumber}`);
    if (!merged.merged) {
      return NextResponse.json({
        status: "failed",
        reason: merged.message || "GitHub declined the merge.",
      });
    }

    await postSignal({
      source: "website",
      headline: `Nova shipped a website change — PR #${prNumber}`,
      detail:
        `${body.title?.trim() ?? ""}\n`.trim() +
        `\nFiles: ${verdict.files.map((f) => f.path).join(", ")}\n` +
        `Repo: ${websiteRepo()}. Merged automatically: content/merchandising only, CI green.`,
    }).catch(() => {});

    return NextResponse.json({ status: "merged" });
  } catch (err) {
    console.error(`[api] web/merge #${prNumber} failed:`, err);
    return NextResponse.json(
      {
        status: "failed",
        reason: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
