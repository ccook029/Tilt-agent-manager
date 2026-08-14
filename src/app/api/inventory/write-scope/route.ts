// ---------------------------------------------------------------------------
// GET /api/inventory/write-scope — can the Zoho token write to the sheet?
//
// /api/inventory/health answers this too, but only as part of a full sweep that
// also pulls every Zoho item and diffs it against the sheet. That's the wrong
// shape for a pre-flight check you run in the second before writing 212 rows,
// so this asks the one question on its own.
//
// Safe to run: the probe updates a serial no stick carries, so it matches zero
// rows and changes nothing. It tests that Zoho ACCEPTS the call, not that a
// write lands.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { checkSheetWriteScope } from "@/lib/zoho-sheet";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const probe = await checkSheetWriteScope();
    return NextResponse.json({ ok: true, ...probe });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        canWrite: false,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
