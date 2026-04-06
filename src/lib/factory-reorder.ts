// ---------------------------------------------------------------------------
// factory-reorder.ts — Biweekly factory reorder recommendation
//
// Compiles stock levels, sales velocity, custom orders, and open POs
// into a structured report for Claude to generate a factory order
// recommendation. Designed for the standard biweekly ordering cycle.
// ---------------------------------------------------------------------------

import {
  fetchAllStickRecords,
  fetchCustomStickRecords,
  type StickRecord,
} from "./zoho-sheet";
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
  // For custom sticks, match by level/carbon/sizeClass only (tab names differ)
  if (filter.level && normalizeLevel(stick.level) !== filter.level) return false;
  if (filter.carbon && stick.carbon.toUpperCase().trim() !== filter.carbon) return false;
  if (filter.sizeClass) {
    if (filter.sizeClass === "ext" && stick.size <= SENIOR_EXT_THRESHOLD) return false;
    if (filter.sizeClass === "standard" && stick.size > SENIOR_EXT_THRESHOLD) return false;
  }
  // For inventory sticks, also check tab
  if (filter.tab && !stick.tab.startsWith("Custom") && stick.tab !== filter.tab) return false;
  return true;
}

interface SkuReorderData {
  sku: string;
  name: string;
  available: number;        // Available sticks in Sheet
  customOrders: number;     // Sticks in Custom Player/Goalie tabs
  sold30d: number;          // Units sold in last 30 days (from sales orders)
  sold14d: number;          // Units sold in last 14 days (one order cycle)
  openPoQty: number;        // Units on open/partial POs not yet received
  purchaseRate: number;     // Cost per unit
}

/**
 * Compile all data needed for a factory reorder recommendation.
 * Returns a formatted text report for Claude.
 */
export async function fetchFactoryReorderData(): Promise<string> {
  const [allSticks, customSticks, items, salesOrders30d, salesOrders14d, openPOs] = await Promise.all([
    fetchAllStickRecords(),
    fetchCustomStickRecords(),
    fetchAllItems(),
    fetchRecentSalesOrders(30),
    fetchRecentSalesOrders(14),
    fetchOpenPurchaseOrders(),
  ]);

  // Index inventory items by SKU
  const itemBySku = new Map<string, ZohoItem>();
  for (const item of items) {
    if (item.sku) itemBySku.set(item.sku.toUpperCase(), item);
  }

  // Calculate sales velocity by SKU (30-day and 14-day)
  const velocity30d = new Map<string, number>();
  for (const order of salesOrders30d) {
    for (const li of order.line_items ?? []) {
      if (li.sku) velocity30d.set(li.sku.toUpperCase(), (velocity30d.get(li.sku.toUpperCase()) ?? 0) + li.quantity);
    }
  }
  const velocity14d = new Map<string, number>();
  for (const order of salesOrders14d) {
    for (const li of order.line_items ?? []) {
      if (li.sku) velocity14d.set(li.sku.toUpperCase(), (velocity14d.get(li.sku.toUpperCase()) ?? 0) + li.quantity);
    }
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

  // Count custom order sticks per SKU from the Custom tabs
  const customCountBySku = new Map<string, number>();
  for (const [sku, filter] of Object.entries(SKU_FILTERS)) {
    const matching = customSticks.filter((s) => stickMatchesSku(s, filter));
    if (matching.length > 0) {
      customCountBySku.set(sku, matching.length);
    }
  }

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
      sold30d: velocity30d.get(sku.toUpperCase()) ?? 0,
      sold14d: velocity14d.get(sku.toUpperCase()) ?? 0,
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
    `Custom Orders Pending: ${totalCustomOrders}`,
    "",
    "### Per-SKU Inventory & Velocity",
    "",
    "| SKU | Product | Available | Custom Orders | Sold (14d) | Sold (30d) | Open PO | Unit Cost |",
    "|-----|---------|-----------|---------------|------------|------------|---------|-----------|",
  ];

  for (const d of skuData) {
    sections.push(
      `| ${d.sku} | ${d.name} | ${d.available} | ${d.customOrders} | ${d.sold14d} | ${d.sold30d} | ${d.openPoQty} | $${d.purchaseRate.toFixed(2)} |`
    );
  }

  // Summary stats
  const totalAvailable = skuData.reduce((sum, d) => sum + d.available, 0);
  const totalSold30d = skuData.reduce((sum, d) => sum + d.sold30d, 0);
  const totalSold14d = skuData.reduce((sum, d) => sum + d.sold14d, 0);
  const totalOpenPo = skuData.reduce((sum, d) => sum + d.openPoQty, 0);
  const totalCustom = skuData.reduce((sum, d) => sum + d.customOrders, 0);

  sections.push(
    "",
    "### Summary",
    `- Total Available Stock: ${totalAvailable} sticks`,
    `- Total Custom Orders Pending: ${totalCustom} sticks`,
    `- Total Sold (last 14 days): ${totalSold14d} sticks`,
    `- Total Sold (last 30 days): ${totalSold30d} sticks`,
    `- Total Open PO (awaiting delivery): ${totalOpenPo} sticks`,
    `- Avg Biweekly Burn Rate: ${totalSold14d} sticks per 2-week cycle`,
  );

  // Custom order details from the Custom Player Sticks / Custom Goalie Sticks tabs
  if (customSticks.length > 0) {
    sections.push(
      "",
      "### Custom Order Details (sticks to include in factory order)",
      `Source: "Custom Player Sticks" and "Custom Goalie Sticks" tabs in Zoho Sheet`,
      "",
      "| Tab | Level | Size | Carbon | Hand | Flex | Curve | Serial |",
      "|-----|-------|------|--------|------|------|-------|--------|",
    );
    for (const stick of customSticks) {
      sections.push(
        `| ${stick.tab} | ${stick.level} | ${stick.size || "-"} | ${stick.carbon || "-"} | ${stick.hand} | ${stick.flex || "-"} | ${stick.curve} | ${stick.serial_number} |`
      );
    }
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

  return sections.join("\n");
}
