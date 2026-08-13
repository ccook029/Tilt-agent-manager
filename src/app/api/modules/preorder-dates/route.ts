// ---------------------------------------------------------------------------
// GET /api/modules/preorder-dates — when each pre-ordered stick is expected.
//
// The storefront reads WHAT is coming from the inventory sheet (rows with
// Status "In Production" and a PROD-nnnn placeholder where the serial will go)
// but the sheet doesn't carry a date. The date belongs to the factory batch,
// which moves — so it stays here, in HQ, where changing it once updates every
// stick in the batch instead of 212 cells.
//
// Auth: Authorization: Bearer <MODULES_SHARED_KEY>, same as the other module
// endpoints tiltweb reads.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { preorderExpectedDates } from "@/lib/preorder-rows";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = process.env.MODULES_SHARED_KEY;
  const auth = request.headers.get("authorization");
  if (!key || auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dates = await preorderExpectedDates().catch(() => ({}));

  return NextResponse.json(
    { ok: true, dates },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
