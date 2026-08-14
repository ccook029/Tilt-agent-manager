// ---------------------------------------------------------------------------
// /api/inventory/preorder — put a factory batch on the storefront.
//
// GET  ?batchId=… → how many rows this would write, without writing.
// POST { batchId } → writes them.
//
// Split in two on purpose: this appends hundreds of rows to the live inventory
// sheet, which is what the website sells from. Nobody should find out the count
// after the fact.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  previewPreorderRows,
  writePreorderRows,
  specsMissingBaseColor,
  backfillBlankBaseColors,
} from "@/lib/preorder-writer";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const batchId = request.nextUrl.searchParams.get("batchId");
  if (!batchId) {
    return NextResponse.json({ ok: false, error: "batchId is required." }, { status: 400 });
  }
  try {
    const [preview, missingBase] = await Promise.all([
      previewPreorderRows(batchId),
      specsMissingBaseColor(batchId),
    ]);
    return NextResponse.json({
      ok: true,
      batchLabel: preview.batch.label,
      expectedDate: preview.batch.expectedDate,
      toWrite: preview.toWrite,
      alreadyWritten: preview.alreadyWritten,
      // Specs no arriving stick can match, so the shipment would append
      // duplicates rather than fill these rows in.
      missingBaseColor: missingBase.reduce((s, m) => s + m.outstanding, 0),
      missingBaseColorSpecs: missingBase.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

/** Fill in blank base colours — see backfillBlankBaseColors. */
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    batchId?: string;
    baseColor?: string;
  };
  if (!body.batchId) {
    return NextResponse.json({ ok: false, error: "batchId is required." }, { status: 400 });
  }
  try {
    const result = await backfillBlankBaseColors(
      body.batchId,
      (body.baseColor || "Black").trim()
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { batchId?: string };
  if (!body.batchId) {
    return NextResponse.json({ ok: false, error: "batchId is required." }, { status: 400 });
  }

  try {
    const result = await writePreorderRows(body.batchId);
    if (result.written > 0) {
      await postSignal({
        source: "inventory",
        headline: `${result.written} sticks listed for pre-order`,
        detail:
          "On the inventory sheet as In Production — buyable on the website with the batch's expected date.",
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
