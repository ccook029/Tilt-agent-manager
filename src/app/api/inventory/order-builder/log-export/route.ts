// POST /api/inventory/order-builder/log-export — drop a line in the HQ signal
// feed when a factory PO is exported, so the draft order shows up in the
// dashboard + Morning Brief (Stockton's world sees it, not just the browser).
import { NextRequest, NextResponse } from "next/server";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    units?: number;
    lines?: number;
    landedCost?: number;
    kind?: string;
  };
  const units = Number(body.units) || 0;
  if (units <= 0) return NextResponse.json({ ok: true, skipped: true });

  const cost = Number(body.landedCost) || 0;
  await postSignal({
    source: "order-builder",
    headline: `Factory ${body.kind === "csv" ? "order CSV" : "PO"} drafted — ${units} sticks`,
    detail: `${body.lines ?? "?"} lines · ~$${Math.round(cost).toLocaleString("en-CA")} CAD landed.`,
  });
  return NextResponse.json({ ok: true });
}
