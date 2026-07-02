// ---------------------------------------------------------------------------
// GET /api/accounting/questions — Download open CFO questions as .xlsx
//
// Fill in the YOUR ANSWER column and re-upload the file in Sterling's chat
// (the 📎 button) — each answered row is recorded as standing policy.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { buildQuestionsWorkbook } from "@/lib/questions-export";

export const dynamic = "force-dynamic";

export async function GET() {
  const wb = await buildQuestionsWorkbook();
  if (!wb) {
    return NextResponse.json({
      ok: true,
      message: "No open questions right now — nothing to download.",
    });
  }
  return new NextResponse(new Uint8Array(wb.buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${wb.filename}"`,
    },
  });
}
