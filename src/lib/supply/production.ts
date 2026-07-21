// ---------------------------------------------------------------------------
// supply/production.ts — "Under Production" status per stick line.
//
// Chris wants the website to show, on each stick product, whether that model is
// currently being made at the factory and roughly when it'll land. The factory
// orders live in Zoho as open Purchase Orders (per granular SKU, e.g.
// "TILT-NGSD-18"); the website sells per MODEL ("Tilt X1 — Senior"). So we:
//
//   1. Pull open POs from Zoho (SKU + qty + expected_delivery_date).
//   2. Roll each SKU up to its stick line via the SKU-prefix rules (mirrors
//      tiltweb's custom-stick-sheet classification).
//   3. Let the Supply Chain Coordinator (Piers) override the expected date or
//      note per line — his call beats the raw Zoho date, since he's the one
//      talking to the factory.
//
// The merged result is exposed to tiltweb via /api/modules/production-status,
// which renders the "Under Production · Expected ~<date>" badge on the store.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { fetchOpenPurchaseOrders } from "@/lib/zoho";

// Each website stick line and the Zoho SKU prefixes that feed it. Order matters:
// goalie (TILT-X1-G*) is matched first so goalie SKUs never fall into a player
// bucket. Player prefixes don't overlap. `productHint` is the tiltweb catalog
// product id, a convenience for mapping (tiltweb stays the source of truth).
export interface StickLine {
  key: string;
  label: string;
  productHint: string;
  skuPrefixes: string[];
}

export const STICK_LINES: StickLine[] = [
  { key: "goalie", label: "Tilt X1 — Goalie", productHint: "tilt-x1-goalie", skuPrefixes: ["TILT-X1-G"] },
  { key: "junior", label: "Tilt X1 — Junior", productHint: "tilt-x1-junior", skuPrefixes: ["TILT-NSDI"] },
  { key: "intermediate", label: "Tilt X1 — Intermediate", productHint: "tilt-x1-intermediate", skuPrefixes: ["TILT-NSD-"] },
  { key: "senior", label: "Tilt X1 — Senior", productHint: "tilt-x1-senior", skuPrefixes: ["TILT-NGSD"] },
];

/** Roll a granular Zoho SKU up to its website stick line (or null if it's not a stick). */
export function classifyStickSku(sku: string): string | null {
  const s = (sku ?? "").toUpperCase();
  for (const line of STICK_LINES) {
    if (line.skuPrefixes.some((p) => s.startsWith(p))) return line.key;
  }
  return null;
}

// ---- Piers' overrides (KV) -------------------------------------------------
// He adjusts the expected date / note per line, or hides a line from the site.
export interface ProductionOverride {
  expectedDate?: string; // YYYY-MM-DD — beats the Zoho PO date
  note?: string; // short public-facing note, e.g. "Next batch in production"
  hidden?: boolean; // don't surface this line on the site at all
  forceUnderProduction?: boolean; // show the badge even with no open PO
  updatedBy?: string;
  updatedAt?: string;
}

const OVERRIDES_KEY = "supply-production-overrides";

export async function getProductionOverrides(): Promise<Record<string, ProductionOverride>> {
  return (await kv.get<Record<string, ProductionOverride>>(OVERRIDES_KEY)) ?? {};
}

export async function setProductionOverride(
  key: string,
  patch: Omit<ProductionOverride, "updatedAt">
): Promise<Record<string, ProductionOverride>> {
  if (!STICK_LINES.some((l) => l.key === key)) {
    throw new Error(`Unknown stick line "${key}"`);
  }
  const all = await getProductionOverrides();
  const now = new Date().toISOString();
  const next = { ...(all[key] ?? {}), ...patch, updatedAt: now };
  // Empty values clear the field rather than storing blanks.
  if (!next.expectedDate) delete next.expectedDate;
  if (!next.note) delete next.note;
  if (!next.hidden) delete next.hidden;
  if (!next.forceUnderProduction) delete next.forceUnderProduction;
  all[key] = next;
  await kv.set(OVERRIDES_KEY, all);
  return all;
}

// ---- The merged production status -----------------------------------------
export interface ProductionItem {
  key: string;
  label: string;
  productHint: string;
  skuPrefixes: string[];
  status: "under_production" | "in_stock";
  onOrderQty: number; // outstanding (ordered − received) across open POs
  expectedDate: string | null; // soonest ETA; Piers' override wins
  expectedSource: "override" | "zoho-po" | null;
  note?: string;
  purchaseOrders: { number: string; expected: string | null; outstanding: number }[];
  hidden: boolean;
  updatedAt?: string;
}

/** Soonest non-empty YYYY-MM-DD from a list, or null. */
function earliest(dates: (string | undefined | null)[]): string | null {
  const valid = dates.filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d));
  if (valid.length === 0) return null;
  return valid.sort((a, b) => a.localeCompare(b))[0];
}

export async function buildProductionStatus(): Promise<ProductionItem[]> {
  const [pos, overrides] = await Promise.all([
    fetchOpenPurchaseOrders().catch(() => []),
    getProductionOverrides().catch(() => ({} as Record<string, ProductionOverride>)),
  ]);

  // Aggregate open-PO lines into each stick line.
  const agg = new Map<string, { qty: number; pos: Map<string, { expected: string | null; outstanding: number }> }>();
  for (const line of STICK_LINES) agg.set(line.key, { qty: 0, pos: new Map() });

  for (const po of pos) {
    for (const li of po.line_items ?? []) {
      const key = classifyStickSku(li.sku);
      if (!key) continue;
      const outstanding = Math.max(0, (li.quantity ?? 0) - (li.quantity_received ?? 0));
      if (outstanding <= 0) continue;
      const bucket = agg.get(key)!;
      bucket.qty += outstanding;
      const prev = bucket.pos.get(po.purchaseorder_number) ?? {
        expected: po.expected_delivery_date || null,
        outstanding: 0,
      };
      prev.outstanding += outstanding;
      bucket.pos.set(po.purchaseorder_number, prev);
    }
  }

  return STICK_LINES.map((line) => {
    const bucket = agg.get(line.key)!;
    const ovr = overrides[line.key] ?? {};
    const purchaseOrders = [...bucket.pos.entries()].map(([number, v]) => ({
      number,
      expected: v.expected,
      outstanding: v.outstanding,
    }));
    const zohoEta = earliest(purchaseOrders.map((p) => p.expected));
    const onOrder = bucket.qty > 0;
    const underProduction = onOrder || !!ovr.forceUnderProduction;

    const expectedDate = ovr.expectedDate ?? zohoEta ?? null;
    const expectedSource: ProductionItem["expectedSource"] = ovr.expectedDate
      ? "override"
      : zohoEta
        ? "zoho-po"
        : null;

    return {
      key: line.key,
      label: line.label,
      productHint: line.productHint,
      skuPrefixes: line.skuPrefixes,
      status: underProduction ? "under_production" : "in_stock",
      onOrderQty: bucket.qty,
      expectedDate,
      expectedSource,
      note: ovr.note,
      purchaseOrders,
      hidden: !!ovr.hidden,
      updatedAt: ovr.updatedAt,
    };
  });
}

/** Prose snapshot for Piers' department context (so the agent can speak to it). */
export async function renderProductionSnapshot(): Promise<string> {
  const items = await buildProductionStatus().catch(() => [] as ProductionItem[]);
  const live = items.filter((i) => i.status === "under_production");
  if (live.length === 0) {
    return "(no stick lines are in factory production right now — nothing to badge on the site)";
  }
  const rows = live.map((i) => {
    const eta = i.expectedDate ? `expected ${i.expectedDate}${i.expectedSource === "override" ? " (your date)" : ""}` : "no ETA yet";
    const pos = i.purchaseOrders.map((p) => p.number).join(", ") || "no open PO";
    return `- ${i.label}: ${i.onOrderQty} on order, ${eta} [${pos}]${i.note ? ` — "${i.note}"` : ""}`;
  });
  return [
    "## Under Production (shown on the website's stick pages)",
    "Sourced from open Zoho factory POs, rolled up per stick line. You set the public ETA per line; your date beats the raw PO date.",
    ...rows,
  ].join("\n");
}
