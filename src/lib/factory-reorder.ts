// ---------------------------------------------------------------------------
// factory-reorder.ts — Biweekly factory reorder recommendation
//
// Compiles stock levels, sales velocity, custom orders, and open POs
// into a structured report for Claude to generate a factory order
// recommendation. Designed for the standard biweekly ordering cycle.
// ---------------------------------------------------------------------------

import { fetchAllStickRecords, type StickRecord } from "./zoho-sheet";
import { fetchAdminCustomQueue, type AdminCustomOrder } from "./custom-queue";
import { TILTWEB_URL } from "./staff-tools";
import {
  fetchAllItems,
  fetchRecentSalesOrders,
  fetchOpenPurchaseOrders,
  type ZohoItem,
} from "./zoho";

// Re-use the SKU filter mapping from zoho-sync
const SKU_FILTERS: Record<string, { tab?: string; level?: string; carbon?: string; sizeClass?: "standard" | "ext" }> = {
  "TILT-NSD-18":     { tab: "Player", level: "INTERMEDIATE", carbon: "18K" },
  "TILT-NSD-24":     { tab: "Player", level: "INTERMEDIATE", carbon: "24K" },
  "TILT-NSDI-18":    { tab: "Player", level: "JUNIOR", carbon: "18K" },
  "TILT-NSDI-24":    { tab: "Player", level: "JUNIOR", carbon: "24K" },
  "TILT-NGSD-18":    { tab: "Player", level: "SENIOR", carbon: "18K", sizeClass: "standard" },
  "TILT-NGSD-24":    { tab: "Player", level: "SENIOR", carbon: "24K", sizeClass: "standard" },
  "TILT-NGSDEXT-18": { tab: "Player", level: "SENIOR", carbon: "18K", sizeClass: "ext" },
  "TILT-NGSDEXT-24": { tab: "Player", level: "SENIOR", carbon: "24K", sizeClass: "ext" },
  "TILT-NSDI-TIER":  { tab: "Player", level: "TIER 1" },
  "TILT-X1-G-INT":   { tab: "Goalie", level: "INTERMEDIATE" },
  "TILT-X1-G-JR":    { tab: "Goalie", level: "JUNIOR" },
  "TILT-X1-G-SR":    { tab: "Goalie", level: "SENIOR" },
};

const SENIOR_EXT_THRESHOLD = 66;

function normalizeLevel(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (upper.startsWith("INT")) return "INTERMEDIATE";
  if (upper.startsWith("JR") || upper.startsWith("JUN")) return "JUNIOR";
  if (upper.startsWith("SR") || upper.startsWith("SEN")) return "SENIOR";
  if (upper.startsWith("GOAL")) return "GOALIE";
  if (upper.startsWith("TIER")) return "TIER 1";
  return upper;
}

function stickMatchesSku(stick: StickRecord, filter: typeof SKU_FILTERS[string]): boolean {
  if (filter.level && normalizeLevel(stick.level) !== filter.level) return false;
  if (filter.carbon && stick.carbon.toUpperCase().trim() !== filter.carbon) return false;
  if (filter.sizeClass) {
    if (filter.sizeClass === "ext" && stick.size <= SENIOR_EXT_THRESHOLD) return false;
    if (filter.sizeClass === "standard" && stick.size > SENIOR_EXT_THRESHOLD) return false;
  }
  if (filter.tab && stick.tab !== filter.tab) return false;
  return true;
}

/** One pending queue order, flattened to the fields SKU matching needs. */
interface QueuedCustom {
  tab: "Player" | "Goalie";
  level: string;
  carbon: string;
  size: number;
  hand: string;
  flex: string;
  curve: string;
  who: string;
}

function specString(specs: Record<string, unknown>, key: string): string {
  return String(specs[key] ?? "").trim();
}

/** Leading number out of spec strings like '56"' or '24" paddle'. */
function specNumber(v: unknown): number {
  const m = String(v ?? "").match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/**
 * Flatten a queued custom order into the shape SKU matching needs. The queue
 * carries specs from six different producers, so carbon may be a field of its
 * own or buried in a model name ("X1 Lazer (18K Carbon)").
 */
function flattenQueuedOrder(o: AdminCustomOrder): QueuedCustom {
  const s = o.specs || {};
  const model = specString(s, "model");
  const carbon =
    specString(s, "carbon") || (model.includes("24K") ? "24K" : model ? "18K" : "");
  const who =
    [o.player_name, o.player_number ? `#${o.player_number}` : ""]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    o.team ||
    "—";
  const goalie = o.kind === "goalie";
  const size = specNumber(goalie ? (s.paddle ?? s.size) : s.size);
  return {
    tab: goalie ? "Goalie" : "Player",
    // Team and ambassador orders don't record a goalie level, so fall back to
    // paddle length — the same brackets the storefront prices against.
    level: goalie ? specString(s, "level") || goalieLevelFromPaddle(size) : specString(s, "level"),
    carbon,
    size,
    hand: specString(s, "hand"),
    flex: specString(s, "flex"),
    curve: specString(s, "curve"),
    who,
  };
}

/** Tilt goalie sizing: ≤22" Junior, 23-24" Intermediate, 25"+ Senior. */
function goalieLevelFromPaddle(paddle: number): string {
  if (!paddle) return "";
  if (paddle <= 22) return "Junior";
  if (paddle <= 24) return "Intermediate";
  return "Senior";
}

function queuedMatchesSku(q: QueuedCustom, filter: typeof SKU_FILTERS[string]): boolean {
  if (filter.tab && q.tab !== filter.tab) return false;
  if (filter.level && normalizeLevel(q.level) !== filter.level) return false;
  if (filter.carbon && q.carbon.toUpperCase().trim() !== filter.carbon) return false;
  if (filter.sizeClass) {
    if (filter.sizeClass === "ext" && q.size <= SENIOR_EXT_THRESHOLD) return false;
    if (filter.sizeClass === "standard" && q.size > SENIOR_EXT_THRESHOLD) return false;
  }
  return true;
}

interface SkuReorderData {
  sku: string;
  name: string;
  available: number;        // Available sticks in the Zoho inventory sheet
  customOrders: number;     // Pending sticks on the admin factory queue
  soldStock30d: number;     // On-hand (serialized) sticks sold in last 30 days
  soldStock14d: number;     // On-hand (serialized) sticks sold in last 14 days
  soldCustom14d: number;    // Build-to-order sticks sold in last 14 days
  openPoQty: number;        // Units on open/partial POs not yet received
  purchaseRate: number;     // Cost per unit
}

/** Headline numbers the pipeline needs to raise an approval decision. */
export interface ReorderSummary {
  totalAvailable: number;
  totalCustomPending: number;
  unmatchedCustoms: number;
  queueError: string | null;
  burnRate14d: number;
}

/**
 * A sales line is an on-hand stick leaving the building only if it carries a
 * serial. Build-to-order customs have no serial — they're already counted on
 * the factory queue, so counting them as velocity too would order the same
 * stick twice.
 */
function lineHasSerial(description?: string): boolean {
  return !!description && description.includes("[S/N:");
}

/**
 * Compile all data needed for a factory reorder recommendation.
 * Returns a formatted text report for Claude plus the headline numbers.
 */
export async function fetchFactoryReorderData(): Promise<{
  report: string;
  summary: ReorderSummary;
}> {
  const [allSticks, customQueue, items, salesOrders30d, salesOrders14d, openPOs] = await Promise.all([
    fetchAllStickRecords(),
    // Committed customs come from the tiltweb admin factory queue — the Zoho
    // custom tabs are retired and the sheet is on-hand inventory only.
    fetchAdminCustomQueue(),
    fetchAllItems(),
    fetchRecentSalesOrders(30),
    fetchRecentSalesOrders(14),
    fetchOpenPurchaseOrders(),
  ]);

  const queueError = "error" in customQueue ? customQueue.error : null;
  const customSticks: QueuedCustom[] =
    "orders" in customQueue ? customQueue.orders.map(flattenQueuedOrder) : [];

  // Index inventory items by SKU
  const itemBySku = new Map<string, ZohoItem>();
  for (const item of items) {
    if (item.sku) itemBySku.set(item.sku.toUpperCase(), item);
  }

  // Sales velocity by SKU, split by whether the stick came off the shelf or
  // was built to order. Only shelf sales create replenishment demand; a custom
  // sale is already represented on the factory queue, and counting it in both
  // places orders the same stick twice.
  let linesSeen = 0;
  let linesWithDescription = 0;
  const tally = (
    orders: typeof salesOrders30d,
    stock: Map<string, number>,
    custom: Map<string, number>
  ) => {
    for (const order of orders) {
      for (const li of order.line_items ?? []) {
        if (!li.sku) continue;
        linesSeen++;
        if (li.description) linesWithDescription++;
        const key = li.sku.toUpperCase();
        const bucket = lineHasSerial(li.description) ? stock : custom;
        bucket.set(key, (bucket.get(key) ?? 0) + li.quantity);
      }
    }
  };

  const stock30d = new Map<string, number>();
  const custom30d = new Map<string, number>();
  tally(salesOrders30d, stock30d, custom30d);

  const stock14d = new Map<string, number>();
  const custom14d = new Map<string, number>();
  tally(salesOrders14d, stock14d, custom14d);

  // Zoho's list endpoint doesn't always return line descriptions. Without them
  // every sale looks custom, which would zero out replenishment — so fall back
  // to the old single-column behaviour and say why.
  const canSplitVelocity = linesSeen === 0 || linesWithDescription > 0;
  if (!canSplitVelocity) {
    for (const [k, v] of custom30d) stock30d.set(k, (stock30d.get(k) ?? 0) + v);
    for (const [k, v] of custom14d) stock14d.set(k, (stock14d.get(k) ?? 0) + v);
    custom30d.clear();
    custom14d.clear();
  }

  // Calculate open PO quantities by SKU (not yet received)
  const openPoQty = new Map<string, number>();
  for (const po of openPOs) {
    for (const li of po.line_items ?? []) {
      if (li.sku) {
        const remaining = li.quantity - (li.quantity_received ?? 0);
        if (remaining > 0) {
          openPoQty.set(li.sku.toUpperCase(), (openPoQty.get(li.sku.toUpperCase()) ?? 0) + remaining);
        }
      }
    }
  }

  // Count pending custom sticks per SKU from the admin factory queue
  const customCountBySku = new Map<string, number>();
  for (const [sku, filter] of Object.entries(SKU_FILTERS)) {
    const matching = customSticks.filter((s) => queuedMatchesSku(s, filter));
    if (matching.length > 0) {
      customCountBySku.set(sku, matching.length);
    }
  }

  // A queued stick that matches no SKU is nearly always missing its carbon —
  // team, ambassador and manual orders don't collect it. Those sticks still
  // have to be built, so they get listed rather than dropped from the count.
  const unattributed = customSticks.filter(
    (s) => !Object.values(SKU_FILTERS).some((f) => queuedMatchesSku(s, f))
  );

  // Build per-SKU data
  const skuData: SkuReorderData[] = [];

  for (const [sku, filter] of Object.entries(SKU_FILTERS)) {
    const item = itemBySku.get(sku.toUpperCase());
    const matchingSticks = allSticks.filter((s) => stickMatchesSku(s, filter));

    const available = matchingSticks.filter((s) => s.status.toLowerCase().trim() === "available").length;

    skuData.push({
      sku,
      name: item?.name ?? sku,
      available,
      customOrders: customCountBySku.get(sku) ?? 0,
      soldStock30d: stock30d.get(sku.toUpperCase()) ?? 0,
      soldStock14d: stock14d.get(sku.toUpperCase()) ?? 0,
      soldCustom14d: custom14d.get(sku.toUpperCase()) ?? 0,
      openPoQty: openPoQty.get(sku.toUpperCase()) ?? 0,
      purchaseRate: item?.purchase_rate ?? 0,
    });
  }

  const totalCustomOrders = customSticks.length;

  // Format the report
  const sections: string[] = [
    "## Factory Reorder Data — Compiled for Recommendation",
    "",
    `Report Date: ${new Date().toISOString().slice(0, 10)}`,
    `Order Cycle: Biweekly (every 2 weeks)`,
    `Target Order Size: ~25 sticks per order`,
    `Total Stick Records in Sheet: ${allSticks.length}`,
    queueError
      ? `Custom Orders Pending: UNKNOWN — the factory queue is unreachable (${queueError}). Every custom count below reads 0 because of that, NOT because there is no custom demand. Do not place an order off this report until the queue is readable.`
      : `Custom Orders Pending: ${totalCustomOrders}`,
    "",
    canSplitVelocity
      ? "'Sold from stock' counts sticks that left the shelf (their sales line carries a serial) — that is the replenishment signal. 'Sold as custom' counts build-to-order sticks, which are ALREADY counted in the Custom Orders column. Never add the two together when sizing a reorder: that orders the same stick twice."
      : "NOTE: Zoho did not return line descriptions on these sales orders, so stock sales and custom builds could not be separated. The Sold column below mixes both. Sticks that appear in the Custom Orders column may also be counted there — treat the replenishment numbers as an upper bound and say so in your summary.",
    "",
    "### Per-SKU Inventory & Velocity",
    "",
    canSplitVelocity
      ? "| SKU | Product | Available | Custom Orders | Sold from stock (14d) | Sold from stock (30d) | Sold as custom (14d) | Open PO | Unit Cost |"
      : "| SKU | Product | Available | Custom Orders | Sold (14d, mixed) | Sold (30d, mixed) | — | Open PO | Unit Cost |",
    "|-----|---------|-----------|---------------|------------|------------|------|---------|-----------|",
  ];

  for (const d of skuData) {
    sections.push(
      `| ${d.sku} | ${d.name} | ${d.available} | ${d.customOrders} | ${d.soldStock14d} | ${d.soldStock30d} | ${canSplitVelocity ? d.soldCustom14d : "—"} | ${d.openPoQty} | $${d.purchaseRate.toFixed(2)} |`
    );
  }

  // Summary stats
  const totalAvailable = skuData.reduce((sum, d) => sum + d.available, 0);
  const totalStock30d = skuData.reduce((sum, d) => sum + d.soldStock30d, 0);
  const totalStock14d = skuData.reduce((sum, d) => sum + d.soldStock14d, 0);
  const totalCustom14d = skuData.reduce((sum, d) => sum + d.soldCustom14d, 0);
  const totalOpenPo = skuData.reduce((sum, d) => sum + d.openPoQty, 0);
  const totalCustom = skuData.reduce((sum, d) => sum + d.customOrders, 0);

  sections.push(
    "",
    "### Summary",
    `- Total Available Stock: ${totalAvailable} sticks`,
    `- Total Custom Orders Pending: ${totalCustom} sticks counted against a SKU` +
      (unattributed.length > 0
        ? `, plus ${unattributed.length} that couldn't be matched to one (listed below) — ${totalCustomOrders} on the queue in total`
        : ""),
    canSplitVelocity
      ? `- Sold from stock (last 14 days): ${totalStock14d} sticks — this is the replenishment burn rate`
      : `- Sold (last 14 days, stock + custom mixed): ${totalStock14d} sticks`,
    canSplitVelocity
      ? `- Sold from stock (last 30 days): ${totalStock30d} sticks`
      : `- Sold (last 30 days, stock + custom mixed): ${totalStock30d} sticks`,
    ...(canSplitVelocity
      ? [
          `- Sold as custom builds (last 14 days): ${totalCustom14d} sticks — already on the queue, do NOT reorder these on top of the custom column`,
        ]
      : []),
    `- Total Open PO (awaiting delivery): ${totalOpenPo} sticks`,
    `- Avg Biweekly Burn Rate: ${totalStock14d} sticks per 2-week cycle`,
  );

  // Pending custom orders — the sticks that must ride this factory order
  if (customSticks.length > 0) {
    sections.push(
      "",
      "### Custom Order Details (sticks to include in factory order)",
      `Source: the admin factory queue at ${TILTWEB_URL}/admin/custom-orders — pending orders only (anything already marked 'ordered' is excluded).`,
      "",
      "| Type | Level | Size | Carbon | Hand | Flex | Curve | For |",
      "|------|-------|------|--------|------|------|-------|-----|",
    );
    for (const stick of customSticks) {
      sections.push(
        `| ${stick.tab} | ${stick.level || "-"} | ${stick.size || "-"} | ${stick.carbon || "-"} | ${stick.hand || "-"} | ${stick.flex || "-"} | ${stick.curve || "-"} | ${stick.who} |`
      );
    }

    if (unattributed.length > 0) {
      sections.push(
        "",
        `### ${unattributed.length} custom stick${unattributed.length === 1 ? "" : "s"} couldn't be matched to a SKU`,
        `These are on the queue and must be built, but their specs don't pin down a SKU — usually a missing carbon grade (team, ambassador and manually-entered orders don't collect it). They are NOT in the per-SKU custom counts above. Add them to the order explicitly and flag the missing spec.`,
        "",
        "| Type | Level | Size | Carbon | Hand | Flex | Curve | For |",
        "|------|-------|------|--------|------|------|-------|-----|",
      );
      for (const stick of unattributed) {
        sections.push(
          `| ${stick.tab} | ${stick.level || "-"} | ${stick.size || "-"} | ${stick.carbon || "MISSING"} | ${stick.hand || "-"} | ${stick.flex || "-"} | ${stick.curve || "-"} | ${stick.who} |`
        );
      }
    }
  } else if (queueError) {
    sections.push(
      "",
      "### Custom Order Details — UNAVAILABLE",
      `The factory queue could not be read (${queueError}), so no custom sticks are listed. Treat the custom column above as unknown, not zero.`,
    );
  }

  // Open PO details
  if (openPOs.length > 0) {
    sections.push(
      "",
      "### Open Purchase Orders (already in pipeline)",
    );
    for (const po of openPOs) {
      const stickLines = (po.line_items ?? []).filter((li) => li.sku?.toUpperCase().startsWith("TILT-"));
      if (stickLines.length === 0) continue;
      sections.push(
        `- **${po.purchaseorder_number}** — ${po.vendor_name} | Status: ${po.status} | Expected: ${po.expected_delivery_date || "TBD"}`,
      );
      for (const li of stickLines) {
        const remaining = li.quantity - (li.quantity_received ?? 0);
        sections.push(
          `  - ${li.sku}: ${li.quantity} ordered, ${li.quantity_received ?? 0} received, ${remaining} pending`
        );
      }
    }
  }

  return {
    report: sections.join("\n"),
    summary: {
      totalAvailable,
      totalCustomPending: totalCustomOrders,
      unmatchedCustoms: unattributed.length,
      queueError,
      burnRate14d: totalStock14d,
    },
  };
}
