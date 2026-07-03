// ---------------------------------------------------------------------------
// GET /api/accounting/progress — cleanup burn-down points for the dashboard.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getProgress } from "@/lib/progress";
import { guardAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await guardAccountingOwner(request);
  if (guard) return guard;

  const points = await getProgress();
  return NextResponse.json(
    { ok: true, points, latest: points[points.length - 1] ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
