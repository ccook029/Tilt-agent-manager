import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import {
  renderPendingStatics,
  renderPendingReels,
  type RenderResult,
} from "@/lib/social/render/pipeline";

/**
 * Renders pending visuals: statics (render_kind = "nano" — Nano Banana Pro
 * treats the real photo, code composites the brand anchor) then reels
 * (render_kind = "shotstack" — auto-cut from the real clip with the same
 * anchor). Needs DATABASE_URL + BLOB_READ_WRITE_TOKEN + GEMINI_API_KEY;
 * reels also need SHOTSTACK_API_KEY (skipped gracefully without it).
 *
 * Body (optional): { limit?, force?, token? } — `force` re-renders posts that
 * already have an image (use after a logo or treatment change).
 */
export const maxDuration = 300;

/**
 * Human-readable outcome for the /setup Activity log: how many rendered, and
 * every skip/failure reason with a count — so "nothing happened" is always
 * explained (e.g. "2 × matched asset is not a video").
 */
function summarizeResults(results: RenderResult[]): string {
  if (results.length === 0) return "nothing pending — all visuals are up to date";
  const rendered = results.filter((r) => r.renderUrl).length;
  const reasons = new Map<string, number>();
  for (const r of results) {
    const reason = r.error ? `failed: ${r.error.slice(0, 160)}` : r.skipped;
    if (!reason || reason === "already rendered") continue;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const parts = [`${rendered} rendered`];
  for (const [reason, n] of reasons) parts.push(`${n} × ${reason}`);
  return parts.join("; ");
}

export async function POST(req: Request) {
  let body: { limit?: number; force?: boolean; token?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Preview mode — no database. Add DATABASE_URL, BLOB_READ_WRITE_TOKEN, and GEMINI_API_KEY in Vercel to render.",
      },
      { status: 400 },
    );
  }

  try {
    const force = body.force === true;
    const statics = await renderPendingStatics({ limit: body.limit, force });
    const reels = await renderPendingReels({ force });
    const results = [...statics, ...reels];
    const rendered = results.filter((r) => r.renderUrl).length;
    const message = summarizeResults(results);
    return NextResponse.json({ ok: true, rendered, message, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
