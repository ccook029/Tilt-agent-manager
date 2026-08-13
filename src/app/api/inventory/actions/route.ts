// ---------------------------------------------------------------------------
// /api/inventory/actions — staged Zoho catalog changes.
//
//   GET            → every batch, resolved against the live catalog
//   POST { id }    → apply that batch (zero stock, then deactivate)
//
// The batch is re-resolved server-side at apply time rather than trusting ids
// posted from the browser, so what runs is what the rules currently match.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { resolveBatch, resolveBatches } from "@/lib/zoho-actions";
import { retireLegacyItems } from "@/lib/legacy-cleanup";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const batches = await resolveBatches();
    return NextResponse.json({ ok: true, batches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const id = String((body as { id?: unknown }).id ?? "");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Pass the batch id." }, { status: 400 });
  }

  try {
    const batch = await resolveBatch(id);
    if (!batch) {
      return NextResponse.json({ ok: false, error: `No batch "${id}".` }, { status: 404 });
    }
    if (batch.matched.length === 0) {
      return NextResponse.json({
        ok: true,
        retired: 0,
        failed: 0,
        unitsZeroed: 0,
        results: [],
        note: "Nothing matched — already done, or the rules no longer hit anything.",
      });
    }

    const results = await retireLegacyItems(batch.matched.map((m) => m.itemId));
    const retired = results.filter((r) => r.deactivated).length;
    const failed = results.length - retired;

    await postSignal({
      source: "inventory",
      headline: `${batch.title} — ${retired} item${retired === 1 ? "" : "s"} retired${failed > 0 ? `, ${failed} failed` : ""}`,
      detail: batch.note,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      retired,
      failed,
      unitsZeroed: results.reduce((s, r) => s + Math.abs(r.stockZeroed), 0),
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
