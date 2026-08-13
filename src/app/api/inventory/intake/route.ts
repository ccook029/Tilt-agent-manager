// ---------------------------------------------------------------------------
// /api/inventory/intake — received stock, from spreadsheet to the sheet.
//
//   POST multipart (file, instructions?) → Stockton reads it; preview, no write
//   POST json { rows }         → writes the included rows as Available stock
//
// Two steps on purpose. The sheet is what the website sells from, so nothing
// lands there without a human seeing what was understood first.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  workbookToGrid,
  interpretIntake,
  commitIntake,
  type IntakeRow,
} from "@/lib/inventory-intake";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  // ---- Commit -------------------------------------------------------------
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    const rows = (body as { rows?: IntakeRow[] }).rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No rows to write." },
        { status: 400 }
      );
    }
    try {
      const result = await commitIntake(rows);
      if (result.added > 0) {
        await postSignal({
          source: "inventory",
          headline: `${result.added} sticks received into inventory`,
          detail: "Added to the Player tab as Available — live on the website.",
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

  // ---- Preview ------------------------------------------------------------
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Attach a .xlsx or .csv file." },
        { status: 400 }
      );
    }
    const instructions = String(form.get("instructions") ?? "");
    const grid = workbookToGrid(await file.arrayBuffer());
    if (grid.length === 0) {
      return NextResponse.json(
        { ok: false, error: "That file has no rows in its first sheet." },
        { status: 400 }
      );
    }
    const result = await interpretIntake(grid, instructions);
    return NextResponse.json({
      ok: true,
      fileName: file.name,
      rowsInFile: grid.length,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
