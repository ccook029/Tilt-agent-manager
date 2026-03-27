// GET /api/inventory/zero-negative — Zero out all negative stock in Zoho Inventory
import { NextResponse } from "next/server";
import { zeroNegativeStock } from "@/lib/zoho-sync";

export const maxDuration = 60;

export async function GET() {
  try {
    const result = await zeroNegativeStock();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
