// ---------------------------------------------------------------------------
// POST /api/marketing/run — trigger Harper's weekly dispatch on demand
//
// Body: { maxPieces?: number, run?: boolean }
//   - Harper plans the week and dispatches work orders to the team.
//   - run: true (default) executes each through the engine now; false leaves
//     them queued for later running.
// Auth: Tilt OS middleware.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { runMarketingWeekly } from "@/lib/pipelines/marketing";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      maxPieces?: number;
      run?: boolean;
    };
    const result = await runMarketingWeekly({
      maxPieces:
        typeof body.maxPieces === "number"
          ? Math.max(1, Math.min(8, body.maxPieces))
          : undefined,
      run: body.run,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api] marketing/run failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
