// ---------------------------------------------------------------------------
// GET /api/accounting/progress — cleanup burn-down points for the dashboard.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { getProgress } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET() {
  const points = await getProgress();
  return NextResponse.json(
    { ok: true, points, latest: points[points.length - 1] ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
