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
import { receiveAgainstProduction } from "@/lib/production-batches";

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

      // Draw down anything these sticks were waiting on. Matching is on spec,
      // not serial — a production line has no serial to match against — and a
      // stick that matches nothing is reported rather than assumed fine.
      // A pre-ordered stick counts as received too: its row was FILLED rather
      // than added, and gating on `added` alone would leave the batch showing
      // 0 of 212 received after the shipment that delivered it.
      const received = result.added + result.filled;
      let production: Awaited<ReturnType<typeof receiveAgainstProduction>> | null = null;
      if (received > 0) {
        production = await receiveAgainstProduction(
          rows
            .filter((r) => !r.excludeReason && r.serial)
            .map((r) => ({
              serial: r.serial,
              level: r.level,
              size: r.size,
              carbon: r.carbon,
              kickPoint: r.kickPoint,
              hand: r.hand,
              flex: r.flex,
              curve: r.curve,
              baseColor: r.baseColor,
              decalColor: r.decalColor,
            }))
        ).catch(() => null);
      }

      if (received > 0) {
        const parts = [
          result.added > 0 ? `${result.added} added` : "",
          result.filled > 0 ? `${result.filled} matched to pre-order rows` : "",
        ].filter(Boolean);
        await postSignal({
          source: "inventory",
          headline: `${received} sticks received into inventory`,
          detail: `${parts.join(", ")} — live on the website.`,
        }).catch(() => {});
      }
      return NextResponse.json({
        ok: true,
        ...result,
        productionMatched: production?.matched.length ?? 0,
        productionUnmatched: production?.unmatched.length ?? 0,
      });
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
