// ---------------------------------------------------------------------------
// serial-audit-export.ts — the count, with specs, as a workbook.
//
// One tab per question the count answers, in the order you'd act on them: the
// specs first (that's the deliverable), then the three exception lists. A tab
// with nothing in it still ships, saying so — an absent tab reads as "not
// checked", and the whole point of an audit is knowing it was checked.
// ---------------------------------------------------------------------------
import type { SerialAudit, CountedSerial } from "./serial-audit";
import { batchSummary } from "./serial-audit";

/** Spec columns, in the master sheet's own order so the two read alike. */
function specRow(m: SerialAudit["matched"][number]) {
  const r = m.record;
  return {
    Serial: m.serial,
    Batch: m.prefix,
    "Batch Month": m.batchMonth,
    Tab: r.tab,
    Level: r.level,
    "Size (inch)": r.size,
    Carbon: r.carbon,
    "Kick Point": r.kick_point,
    Hand: r.hand,
    Flex: r.flex,
    Curve: r.curve,
    "Base Color": r.base_color,
    "Decal Color": r.decal_color,
    Status: r.status,
    "Date Sold": r.date_sold,
    "Sheet Row": r.row_index,
    Note: m.note,
  };
}

const SPEC_WIDTHS = [
  16, 10, 12, 10, 10, 11, 9, 11, 7, 7, 10, 12, 12, 14, 11, 10, 40,
];

export interface AuditWorkbook {
  buffer: Buffer;
  filename: string;
}

export async function buildSerialAuditWorkbook(
  counted: CountedSerial[],
  audit: SerialAudit,
  today: string
): Promise<AuditWorkbook> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const add = (
    name: string,
    rows: Record<string, string | number>[],
    widths: number[],
    emptyMessage: string
  ) => {
    const ws =
      rows.length > 0
        ? XLSX.utils.json_to_sheet(rows)
        : XLSX.utils.aoa_to_sheet([[emptyMessage]]);
    ws["!cols"] = (rows.length > 0 ? widths : [80]).map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  // 1. The specs — every counted stick the sheet could identify.
  add("Stick Specs", audit.matched.map(specRow), SPEC_WIDTHS, "Nothing matched.");

  // 2. Counted but untracked. These are real sticks nobody can sell.
  add(
    "Not On Sheet",
    audit.notOnSheet.map((n) => ({
      Serial: n.serial,
      Batch: n.prefix,
      "Batch Month": n.batchMonth,
      Format: n.format,
      Note: n.note,
      Action: "Add to the master sheet — it can't be listed until it's there",
    })),
    [16, 10, 12, 12, 40, 60],
    "Every counted stick is on the sheet."
  );

  // 3. The sheet says here, the rack says otherwise.
  add(
    "Missing From Count",
    audit.missingFromCount.map((m) => ({
      Serial: m.record.serial_number,
      Status: m.status,
      Tab: m.record.tab,
      Level: m.record.level,
      "Size (inch)": m.record.size,
      Carbon: m.record.carbon,
      Curve: m.record.curve,
      Flex: m.record.flex,
      "Base Color": m.record.base_color,
      "Decal Color": m.record.decal_color,
      "Sheet Row": m.record.row_index,
      Action: "Listed for sale but not found — locate it or take it off the sheet",
    })),
    [16, 12, 10, 10, 11, 9, 10, 7, 12, 12, 10, 62],
    "Everything the sheet says is on hand was counted."
  );

  // 4. Sold, and still on the rack.
  add(
    "Sold But Present",
    audit.soldButPresent.map((m) => ({
      Serial: m.serial,
      "Date Sold": m.record.date_sold,
      Level: m.record.level,
      "Size (inch)": m.record.size,
      Curve: m.record.curve,
      Flex: m.record.flex,
      "Sheet Row": m.record.row_index,
      Action: "Either it hasn't shipped yet, or the sale was recorded on the wrong stick",
    })),
    [16, 11, 10, 11, 10, 7, 10, 66],
    "No sold stick was found on the rack."
  );

  // 5. Batch rollup.
  add(
    "Batch Summary",
    batchSummary(counted, audit).map((b) => ({
      Batch: b.prefix,
      Month: b.batchMonth,
      Format: b.format === "wide-date" ? "7-char (non-standard)" : b.format,
      Counted: b.count,
      "On Sheet": b.matched,
      "Sequence Range": b.sequenceRange,
    })),
    [12, 10, 22, 9, 10, 22],
    "Nothing counted."
  );

  // 6. What this file is, so it still makes sense in six months.
  const s = audit.summary;
  const totals = XLSX.utils.aoa_to_sheet([
    ["Tilt — serial count vs. master inventory sheet"],
    ["Counted on", today],
    [],
    ["Serials counted", s.counted],
    ["Matched to the sheet (see Stick Specs)", s.matched],
    ["Counted but not on the sheet", s.notOnSheet],
    ["On the sheet, not counted", s.missingFromCount],
    ["Sold on the sheet but physically present", s.soldButPresent],
    ["Counted twice", audit.duplicatesInCount.length],
    [],
    ["Sheet rows excluded — not built yet", s.skippedNotYetBuilt],
    [
      "",
      "Pre-order rows (PROD- placeholder or In Production) are at the factory, so a floor count can't contradict them.",
    ],
    [],
    ["Duplicates", audit.duplicatesInCount.join(", ") || "none"],
  ]);
  totals["!cols"] = [{ wch: 44 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, totals, "Summary");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buffer, filename: `tilt-serial-audit-${today}.xlsx` };
}
