// POST /api/inventory/order-builder/logic-pdf — Stockton writes the "Order
// Logic" memo for the currently drafted order and returns it as a PDF, so the
// reasoning travels with the PO. OS session required (middleware).
import { NextRequest, NextResponse } from "next/server";
import { generateReportPDF } from "@/lib/pdf";
import { generateOrderLogic, type OrderLogicInput } from "@/lib/order-builder/logic";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: OrderLogicInput;
  try {
    body = (await request.json()) as OrderLogicInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!Array.isArray(body.player) || body.player.length + (body.goalie?.length ?? 0) === 0) {
    return NextResponse.json({ error: "Generate an order first." }, { status: 400 });
  }

  try {
    const text = await generateOrderLogic({ ...body, goalie: body.goalie ?? [] });
    const reportDate = new Date().toISOString().slice(0, 10);
    const pdf = await generateReportPDF({
      title: "Factory Order Logic",
      subtitle: "How this order was derived — Stick Order Builder",
      reportDate,
      agentName: "Stockton Ledger — Director of Inventory Operations",
      reportText: text,
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="TILT_Order_Logic_${reportDate}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
