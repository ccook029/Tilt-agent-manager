// ---------------------------------------------------------------------------
// /api/supply/production — the Supply Chain Coordinator's control over the
// website's "Under Production" badges.
//
// GET  → every stick line with its live status (from Zoho POs) + any override.
// POST { key, expectedDate?, note?, hidden?, forceUnderProduction? }
//      → set Piers' override for one line. His expected date beats the raw Zoho
//        PO date, since he's the one talking to the factory about timelines.
// Auth: Tilt OS middleware (owner/staff console).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  buildProductionStatus,
  getProductionOverrides,
  setProductionOverride,
} from "@/lib/supply/production";

export const dynamic = "force-dynamic";

export async function GET() {
  const [items, overrides] = await Promise.all([
    buildProductionStatus().catch(() => []),
    getProductionOverrides().catch(() => ({})),
  ]);
  return NextResponse.json({ ok: true, items, overrides });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key : "";
    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
    const overrides = await setProductionOverride(key, {
      expectedDate: str(body.expectedDate),
      note: str(body.note),
      hidden: body.hidden === true,
      forceUnderProduction: body.forceUnderProduction === true,
      updatedBy: str(body.updatedBy),
    });
    return NextResponse.json({ ok: true, overrides });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
