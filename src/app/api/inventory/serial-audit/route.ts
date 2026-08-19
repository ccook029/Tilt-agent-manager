// ---------------------------------------------------------------------------
// POST /api/inventory/serial-audit — reconcile a physical serial count against
// the live master sheet.
//
// Body: { serials: "<one per line>" } or { counted: [{serial, note}] }
//       ?format=xlsx returns the workbook instead of JSON.
//
// The sheet is read live and in full. A partial read would make every unread
// row look like missing stock, so a failed read is an error here rather than a
// short answer — see the throw below.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { fetchAllStickRecords } from "@/lib/zoho-sheet";
import { auditSerials, parseCountInput, type CountedSerial } from "@/lib/serial-audit";
import { buildSerialAuditWorkbook } from "@/lib/serial-audit-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  let body: { serials?: string; counted?: CountedSerial[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON." }, { status: 400 });
  }

  const counted: CountedSerial[] = Array.isArray(body.counted)
    ? body.counted.filter((c) => c && typeof c.serial === "string")
    : parseCountInput(body.serials ?? "");

  if (counted.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No serials to check. Paste one per line." },
      { status: 400 }
    );
  }

  let records;
  try {
    records = await fetchAllStickRecords();
  } catch (err) {
    // Deliberately not a partial answer: with no sheet, every counted stick
    // reads as untracked and every discrepancy is fictional.
    return NextResponse.json(
      {
        ok: false,
        error: `Couldn't read the master sheet, so nothing was compared: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 }
    );
  }

  const audit = auditSerials(counted, records);

  if (new URL(req.url).searchParams.get("format") === "xlsx") {
    const { buffer, filename } = await buildSerialAuditWorkbook(counted, audit, today());
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    sheetRows: records.length,
    summary: audit.summary,
    matched: audit.matched.map((m) => ({
      serial: m.serial,
      batchMonth: m.batchMonth,
      level: m.record.level,
      size: m.record.size,
      carbon: m.record.carbon,
      kickPoint: m.record.kick_point,
      hand: m.record.hand,
      flex: m.record.flex,
      curve: m.record.curve,
      baseColor: m.record.base_color,
      decalColor: m.record.decal_color,
      status: m.record.status,
      dateSold: m.record.date_sold,
      tab: m.record.tab,
      note: m.note,
    })),
    notOnSheet: audit.notOnSheet,
    soldButPresent: audit.soldButPresent.map((m) => ({
      serial: m.serial,
      dateSold: m.record.date_sold,
      level: m.record.level,
      curve: m.record.curve,
    })),
    missingFromCount: audit.missingFromCount.map((m) => ({
      serial: m.record.serial_number,
      status: m.status,
      level: m.record.level,
      size: m.record.size,
      carbon: m.record.carbon,
      curve: m.record.curve,
      flex: m.record.flex,
      tab: m.record.tab,
    })),
    duplicatesInCount: audit.duplicatesInCount,
  });
}
