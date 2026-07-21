// ---------------------------------------------------------------------------
// GET /api/modules/production-status — the "Under Production" feed for tiltweb.
//
// For each Tilt stick line it reports whether the factory is currently making
// it and the soonest expected date, so the storefront can render an
// "Under Production · Expected ~<date>" badge on the product page. Hidden lines
// (per Piers' override) are omitted.
//
// Auth: Authorization: Bearer <MODULES_SHARED_KEY> — same shared key tiltweb's
// own module endpoints use, in the reverse direction (hub → tiltweb reads).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { buildProductionStatus } from "@/lib/supply/production";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = process.env.MODULES_SHARED_KEY;
  const auth = request.headers.get("authorization");
  if (!key || auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = (await buildProductionStatus().catch(() => []))
    .filter((i) => !i.hidden)
    .map((i) => ({
      key: i.key,
      label: i.label,
      product_hint: i.productHint,
      sku_prefixes: i.skuPrefixes,
      under_production: i.status === "under_production",
      on_order_qty: i.onOrderQty,
      expected_date: i.expectedDate,
      note: i.note ?? null,
    }));

  return NextResponse.json(
    { ok: true, items },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
