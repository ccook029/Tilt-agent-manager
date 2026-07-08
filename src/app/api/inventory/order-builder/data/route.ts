// GET /api/inventory/order-builder/data — live Stockton dataset for the
// Order Builder (OS session required; the hub middleware gates this route).
import { NextResponse } from "next/server";
import { buildOrderDataset } from "@/lib/order-builder/data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await buildOrderDataset();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
