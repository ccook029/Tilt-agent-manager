// ---------------------------------------------------------------------------
// /api/inventory/production — sticks at the factory, not yet here.
//
//   GET                         → open batches + outstanding totals
//   POST multipart (file, …)    → Stockton reads a production list; preview
//   POST json { label, expectedDate, lines }  → save the batch
//   PATCH { id, expectedDate }  → the date moved (it usually does)
//   DELETE ?id=                 → drop a batch
//
// Production lists have no serial numbers, so the preview intentionally uses a
// different rule to Receive Stock: rows here are expected to be serial-less,
// and are aggregated into quantities per spec.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { workbookToGrid, interpretIntake } from "@/lib/inventory-intake";
import {
  listBatches,
  addBatch,
  deleteBatch,
  updateBatchDate,
  outstandingLines,
  aggregateLines,
  describeSpec,
  type ProductionLine,
} from "@/lib/production-batches";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const [batches, outstanding] = await Promise.all([
    listBatches(),
    outstandingLines(),
  ]);
  return NextResponse.json({
    ok: true,
    batches,
    outstanding: outstanding.map((l) => ({ ...l, label: describeSpec(l) })),
    totalOutstanding: outstanding.reduce((s, l) => s + l.outstanding, 0),
  });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  // ---- Save --------------------------------------------------------------
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
      expectedDate?: string;
      lines?: ProductionLine[];
    };
    const label = (body.label ?? "").trim();
    const expectedDate = (body.expectedDate ?? "").trim();
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (!label) {
      return NextResponse.json({ ok: false, error: "Give the batch a name." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
      return NextResponse.json(
        { ok: false, error: "Expected date must be YYYY-MM-DD." },
        { status: 400 }
      );
    }
    if (lines.length === 0) {
      return NextResponse.json({ ok: false, error: "No lines to save." }, { status: 400 });
    }

    const batch = await addBatch({
      label,
      expectedDate,
      createdBy: "HQ",
      lines: lines.map((l) => ({ ...l, received: 0 })),
    });
    const total = batch.lines.reduce((s, l) => s + l.quantity, 0);
    await postSignal({
      source: "inventory",
      headline: `${total} sticks in production — ${label}, due ${expectedDate}`,
      detail: `${batch.lines.length} distinct specs. They draw down automatically as the shipment is received.`,
    }).catch(() => {});
    return NextResponse.json({ ok: true, batch, total });
  }

  // ---- Preview -----------------------------------------------------------
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Attach a .xlsx or .csv file." }, { status: 400 });
    }
    const instructions = String(form.get("instructions") ?? "");
    const grid = workbookToGrid(await file.arrayBuffer());

    // Production lists carry no serials, so the serial rule that governs
    // Receive Stock would reject every row here.
    const result = await interpretIntake(
      grid,
      `${instructions}\n\nThis is a PRODUCTION list — sticks being built at the factory, not stock in hand. They have NO serial numbers yet, and that is expected: do NOT exclude a row for having no serial. Include every stick being built. Still exclude custom builds with a player name, goalie sticks, separators and headings.`.trim()
    );

    const usable = result.rows.filter(
      (r) => !r.excludeReason || r.excludeReason === "No serial number"
    );
    const lines = aggregateLines(usable);

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      rowsInFile: grid.length,
      interpretation: result.interpretation,
      warnings: result.warnings,
      sticksFound: usable.length,
      lines: lines.map((l) => ({ ...l, label: describeSpec(l) })),
      excluded: result.rows
        .filter((r) => r.excludeReason && r.excludeReason !== "No serial number")
        .map((r) => ({ sourceRow: r.sourceRow, reason: r.excludeReason })),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    expectedDate?: string;
  };
  if (!body.id || !/^\d{4}-\d{2}-\d{2}$/.test(body.expectedDate ?? "")) {
    return NextResponse.json(
      { ok: false, error: "Need an id and a YYYY-MM-DD date." },
      { status: 400 }
    );
  }
  const ok = await updateBatchDate(body.id, body.expectedDate!);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Pass ?id=" }, { status: 400 });
  }
  const ok = await deleteBatch(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
