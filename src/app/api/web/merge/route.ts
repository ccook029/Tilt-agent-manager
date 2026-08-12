// ---------------------------------------------------------------------------
// POST /api/web/merge — Nova ships a content/merchandising change to the store.
//
// Body: { prNumber, title? }. Auth: Tilt OS middleware (founder console).
//
// The decision itself lives in lib/web/auto-merge so this route and the
// work-order ship executor can't drift: both re-derive the policy from the PR's
// real files and diffs, and both require CI green. A client that lies about
// what it's merging gets refused, because nothing here trusts the request body
// beyond the PR number.
//
// Returns: merged | pending | blocked | failed — the chat card polls on
// "pending".
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { websiteRepoConfigured } from "@/lib/web/github";
import { tryAutoMerge } from "@/lib/web/auto-merge";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!websiteRepoConfigured()) {
    return NextResponse.json(
      { status: "failed", reason: "GITHUB_TOKEN is not set." },
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
      { status: "failed", reason: "prNumber is required." },
      { status: 400 }
    );
  }

  const outcome = await tryAutoMerge(
    prNumber,
    body.title?.trim() || `Nova: PR #${prNumber}`
  );
  return NextResponse.json(outcome);
}
