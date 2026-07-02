// ---------------------------------------------------------------------------
// questions-export.ts — Open CFO questions as an Excel workbook
//
// Chris answers questions in bulk via spreadsheet: download (or receive in the
// daily digest) an .xlsx of all open questions, fill in the YOUR ANSWER column,
// and re-upload it in Sterling's chat — each filled row is recorded as standing
// policy. The Question ID column is the join key; don't edit it.
// ---------------------------------------------------------------------------
import { getOpenEscalations } from "./policy-ledger";

export const ANSWER_COLUMN = "YOUR ANSWER";
export const ID_COLUMN = "Question ID";

/** Build the open-questions workbook. Returns null when there's nothing open. */
export async function buildQuestionsWorkbook(): Promise<{
  buffer: Buffer;
  filename: string;
  count: number;
} | null> {
  const open = await getOpenEscalations();
  if (open.length === 0) return null;

  const XLSX = await import("xlsx");
  const rows = open.map((e) => ({
    [ID_COLUMN]: e.id,
    Raised: e.raisedAt.slice(0, 10),
    Question: e.question,
    "Why it needs you": e.reason,
    "Amount ($)": e.dollarAmount ?? "",
    "Sterling's Recommendation": e.recommendation ?? "",
    [ANSWER_COLUMN]: "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 22 }, // id
    { wch: 11 }, // raised
    { wch: 70 }, // question
    { wch: 45 }, // reason
    { wch: 10 }, // amount
    { wch: 45 }, // recommendation
    { wch: 60 }, // answer
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Questions");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return {
    buffer,
    filename: `tilt-cfo-questions-${new Date().toISOString().slice(0, 10)}.xlsx`,
    count: open.length,
  };
}
