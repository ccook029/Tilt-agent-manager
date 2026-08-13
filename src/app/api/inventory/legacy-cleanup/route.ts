// ---------------------------------------------------------------------------
// /api/inventory/legacy-cleanup — retire legacy stick SKUs with phantom stock.
//
//   GET  → the current list of retirable legacy stick SKUs (always a dry run)
//   POST { itemIds } → zero their stock + mark them inactive
//
// The lib re-derives what counts as "legacy" from live Zoho data on every
// call, so the 12 active SKUs cannot be retired through here regardless of
// what ids are posted. Backing UI: /inventory/cleanup.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { listLegacyStickItems, retireLegacyItems } from "@/lib/legacy-cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const items = await listLegacyStickItems();
    return NextResponse.json({
      ok: true,
      count: items.length,
      totalPhantomUnits: items.reduce((s, i) => s + i.stockOnHand, 0),
      items,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const itemIds = (body as { itemIds?: unknown }).itemIds;
  if (!Array.isArray(itemIds) || itemIds.length === 0 || !itemIds.every((i) => typeof i === "string")) {
    return NextResponse.json(
      { ok: false, error: "Pass itemIds: a non-empty array of Zoho item ids." },
      { status: 400 }
    );
  }
  if (itemIds.length > 300) {
    return NextResponse.json(
      { ok: false, error: "That's over 300 items — run it in batches." },
      { status: 400 }
    );
  }

  try {
    const results = await retireLegacyItems(itemIds);
    return NextResponse.json({
      ok: true,
      retired: results.filter((r) => r.deactivated).length,
      failed: results.filter((r) => !r.deactivated).length,
      unitsZeroed: results.reduce((s, r) => s + r.stockZeroed, 0),
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
