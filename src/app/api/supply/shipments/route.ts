// ---------------------------------------------------------------------------
// /api/supply/shipments — the shipment register API.
//
// GET               → all shipments (open first, then by ETA)
// POST { ...fields } → create (or update when `id` is present)
// DELETE ?id=       → remove a shipment
// Auth: Tilt OS middleware.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  createShipment,
  deleteShipment,
  listShipments,
  updateShipment,
  type ShipmentStatus,
} from "@/lib/supply/shipments";

export async function GET() {
  return NextResponse.json({ shipments: await listShipments() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const method = str(body.method);
    const status = str(body.status) as ShipmentStatus | undefined;

    if (typeof body.id === "string" && body.id) {
      const updated = await updateShipment(body.id, {
        vendor: str(body.vendor),
        reference: str(body.reference),
        trackingNumber: str(body.trackingNumber),
        carrier: str(body.carrier),
        origin: str(body.origin),
        method: method === "sea" || method === "air" || method === "courier" ? method : undefined,
        expectedDate: str(body.expectedDate),
        status,
        notes: str(body.notes),
      });
      if (!updated) {
        return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, shipment: updated });
    }

    const vendor = str(body.vendor)?.trim();
    const reference = str(body.reference)?.trim();
    if (!vendor || !reference) {
      return NextResponse.json(
        { error: "vendor and reference are required." },
        { status: 400 }
      );
    }
    const shipment = await createShipment({
      vendor,
      reference,
      trackingNumber: str(body.trackingNumber),
      carrier: str(body.carrier),
      origin: str(body.origin),
      method: method === "sea" || method === "air" || method === "courier" ? method : undefined,
      expectedDate: str(body.expectedDate),
      status,
      notes: str(body.notes),
      createdBy: str(body.createdBy),
    });
    return NextResponse.json({ ok: true, shipment });
  } catch (err) {
    console.error("[api] supply/shipments POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteShipment(id);
  return NextResponse.json({ ok });
}
