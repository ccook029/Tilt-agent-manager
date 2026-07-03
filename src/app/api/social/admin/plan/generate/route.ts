import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { generatePlan, clearGeneratedPlan } from "@/lib/social/planner/generate";

/**
 * Regenerates the plan: 6-month skeleton (deterministic) + locked-window posts
 * and gaps (brain). Needs DATABASE_URL + ANTHROPIC_API_KEY. A full locked-window
 * run makes one model call per slot, so prefer the CLI (`npm run plan:generate`)
 * for the full run; this endpoint is fine for small windows.
 *
 * Body (optional): { weeks?, lockedDays?, token? }
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { weeks?: number; lockedDays?: number; token?: string } = {};
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
          "Preview mode — no database. Add DATABASE_URL and ANTHROPIC_API_KEY in Vercel to generate a real plan.",
      },
      { status: 400 },
    );
  }

  try {
    await clearGeneratedPlan();
    const summary = await generatePlan({
      weeks: body.weeks,
      lockedDays: body.lockedDays,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
