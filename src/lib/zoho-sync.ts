// ---------------------------------------------------------------------------
// zoho-sync.ts — Sheet → Inventory stock reconciliation
//
// The master Zoho Sheet tracks individual sticks by serial number.
// Zoho Inventory tracks stock at the SKU level.
//
// This module uses EXPLICIT SKU MAPPINGS to match each Zoho Inventory
// stick SKU to a filter that counts matching sticks in the Sheet.
//
// SKU types:
//   Player sticks:  matched by tab + level + carbon (+ size for EXT)
//   Goalie sticks:  matched by tab + level (no carbon distinction)
//   Tier 1 sticks:  matched by level only (no carbon distinction)
//
// The Sheet is the source of truth for stick stock levels.
// Non-stick items (grips, apparel, accessories) live only in Inventory.
// ---------------------------------------------------------------------------

import {
  fetchAllStickRecords,
  type StickRecord,
} from "./zoho-sheet";
import {
  fetchAllItems,
  createInventoryAdjustment,
  type ZohoItem,
} from "./zoho";

// ---- Types ----------------------------------------------------------------

export interface SkuMatch {
  sku: string;
  name: string;
  itemId: string;
  sheetCount: number;
  inventoryCount: number;
  difference: number;
}

export interface SyncDiff {
  /** SKUs where sheet count matches inventory stock_on_hand */
  inSync: SkuMatch[];
  /** SKUs where sheet count differs from inventory stock_on_hand */
  discrepancies: SkuMatch[];
  /** Active stick SKUs in Inventory that have no mapping defined */
  unmappedSkus: ZohoItem[];
  /** Non-stick Inventory items — not in scope */
  nonStickItems: number;
  /** Stick records from Sheet that didn't match any SKU filter */
  unmatchedSticks: number;
  /** Total available sticks counted from the Sheet */
  totalSheetAvailable: number;
}

// ---- Explicit SKU → Sheet filter mapping ----------------------------------

/**
 * Filter criteria for matching Sheet stick records to a Zoho Inventory SKU.
 * Each SKU defines what sticks it represents.
 */
interface SkuFilter {
  /** Which tab(s) to look in. If omitted, checks all tabs. */
  tab?: string;
  /** Level value in the Sheet (normalized to uppercase). */
  level?: string;
  /** Carbon value in the Sheet (e.g. "18K"). If omitted, matches any carbon. */
  carbon?: string;
  /** Size filter: "standard" = ≤66", "ext" = >66". If omitted, matches any size. */
  sizeClass?: "standard" | "ext";
}

/**
 * Explicit mapping of every active Tilt stick SKU to its Sheet filter.
 *
 * Player sticks: Level + Carbon, split by size for Senior EXT variants
 * Goalie sticks: Level only (from the Goalie tab)
 * Tier 1: Level only
 */
const SKU_FILTERS: Record<string, SkuFilter> = {
  // Player — Intermediate (all sizes)
  "TILT-NSD-18":     { tab: "Player", level: "INTERMEDIATE", carbon: "18K" },
  "TILT-NSD-24":     { tab: "Player", level: "INTERMEDIATE", carbon: "24K" },

  // Player — Junior (all sizes)
  "TILT-NSDI-18":    { tab: "Player", level: "JUNIOR", carbon: "18K" },
  "TILT-NSDI-24":    { tab: "Player", level: "JUNIOR", carbon: "24K" },

  // Player — Senior regular (63-66")
  "TILT-NGSD-18":    { tab: "Player", level: "SENIOR", carbon: "18K", sizeClass: "standard" },
  "TILT-NGSD-24":    { tab: "Player", level: "SENIOR", carbon: "24K", sizeClass: "standard" },

  // Player — Senior EXT (over 66")
  "TILT-NGSDEXT-18": { tab: "Player", level: "SENIOR", carbon: "18K", sizeClass: "ext" },
  "TILT-NGSDEXT-24": { tab: "Player", level: "SENIOR", carbon: "24K", sizeClass: "ext" },

  // Player — Tier 1 (any carbon)
  "TILT-NSDI-TIER":  { tab: "Player", level: "TIER 1" },

  // Goalie — by player level (any carbon)
  "TILT-X1-G-INT":   { tab: "Goalie", level: "INTERMEDIATE" },
  "TILT-X1-G-JR":    { tab: "Goalie", level: "JUNIOR" },
  "TILT-X1-G-SR":    { tab: "Goalie", level: "SENIOR" },
};

/** Senior EXT size threshold: sticks over 66" are EXT. */
const SENIOR_EXT_THRESHOLD = 66;

/**
 * Normalize a level string for matching.
 */
function normalizeLevel(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (upper.startsWith("INT")) return "INTERMEDIATE";
  if (upper.startsWith("JR") || upper.startsWith("JUN")) return "JUNIOR";
  if (upper.startsWith("SR") || upper.startsWith("SEN")) return "SENIOR";
  if (upper.startsWith("GOAL")) return "GOALIE";
  if (upper.startsWith("TIER")) return "TIER 1";
  return upper;
}

/**
 * Check if a stick record matches a SKU filter.
 */
function stickMatchesFilter(stick: StickRecord, filter: SkuFilter): boolean {
  // Tab filter
  if (filter.tab && stick.tab !== filter.tab) return false;

  // Level filter
  if (filter.level && normalizeLevel(stick.level) !== filter.level) return false;

  // Carbon filter
  if (filter.carbon && stick.carbon.toUpperCase().trim() !== filter.carbon) return false;

  // Size class filter (for Senior standard vs EXT)
  if (filter.sizeClass) {
    if (filter.sizeClass === "ext" && stick.size <= SENIOR_EXT_THRESHOLD) return false;
    if (filter.sizeClass === "standard" && stick.size > SENIOR_EXT_THRESHOLD) return false;
  }

  return true;
}

// ---- Non-stick SKU detection ----------------------------------------------

const NON_STICK_PREFIXES = [
  "GRIP-", "T-S-", "HOO-", "HAT-", "SOC-", "BAG-",
  "TOW-", "BAN-", "STI-", "WAX-", "TAP-", "LAC-",
];

function isNonStickSku(sku: string): boolean {
  const upper = sku.toUpperCase();
  return NON_STICK_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

// ---- Diff: compare sheet stock vs inventory -------------------------------

/**
 * Compare the master sheet stick counts against Zoho Inventory.
 * Uses explicit SKU filters for accurate matching.
 * Does NOT make any changes — read-only comparison.
 */
export async function compareSheetToInventory(): Promise<SyncDiff> {
  const [allSticks, inventoryItems] = await Promise.all([
    fetchAllStickRecords(),
    fetchAllItems(),
  ]);

  // Only count "Available" sticks
  const availableSticks = allSticks.filter(
    (s) => s.status.toLowerCase().trim() === "available"
  );

  // Index inventory items by SKU (uppercase)
  const inventoryBySku = new Map<string, ZohoItem>();
  for (const item of inventoryItems) {
    if (item.sku) {
      inventoryBySku.set(item.sku.toUpperCase(), item);
    }
  }

  // For each mapped SKU, count matching available sticks
  const inSync: SkuMatch[] = [];
  const discrepancies: SkuMatch[] = [];
  const matchedSticks = new Set<number>(); // Track by row_index to avoid double-counting

  for (const [sku, filter] of Object.entries(SKU_FILTERS)) {
    const item = inventoryBySku.get(sku.toUpperCase());
    if (!item) continue; // SKU not in Inventory — skip (shouldn't happen for active SKUs)

    // Count matching available sticks
    let count = 0;
    for (const stick of availableSticks) {
      if (stickMatchesFilter(stick, filter)) {
        count++;
        matchedSticks.add(stick.row_index);
      }
    }

    const match: SkuMatch = {
      sku: item.sku,
      name: item.name,
      itemId: item.item_id,
      sheetCount: count,
      inventoryCount: item.stock_on_hand,
      difference: count - item.stock_on_hand,
    };

    if (match.difference === 0) {
      inSync.push(match);
    } else {
      discrepancies.push(match);
    }
  }

  // Find unmapped stick SKUs (active sticks in Inventory with no filter defined)
  const mappedSkus = new Set(Object.keys(SKU_FILTERS).map((s) => s.toUpperCase()));
  const unmappedSkus: ZohoItem[] = [];
  let nonStickItems = 0;

  for (const item of inventoryItems) {
    if (!item.sku) continue;
    const upper = item.sku.toUpperCase();
    if (mappedSkus.has(upper)) continue;
    if (isNonStickSku(item.sku)) {
      nonStickItems++;
      continue;
    }
    unmappedSkus.push(item);
  }

  // Count sticks that didn't match any filter
  const unmatchedSticks = availableSticks.length - matchedSticks.size;

  return {
    inSync,
    discrepancies,
    unmappedSkus,
    nonStickItems,
    unmatchedSticks,
    totalSheetAvailable: availableSticks.length,
  };
}

// ---- Formatted output for prompt injection --------------------------------

/**
 * Run a full comparison and format the results as text for Claude.
 */
export async function fetchSyncReport(): Promise<string> {
  try {
    const diff = await compareSheetToInventory();

    const totalMatched = diff.inSync.length + diff.discrepancies.length;
    const totalMappedCount = [...diff.inSync, ...diff.discrepancies].reduce(
      (sum, m) => sum + m.sheetCount, 0
    );

    const sections: string[] = [
      "## Sheet ↔ Inventory Stock Reconciliation Report",
      "",
      "Each Zoho Inventory stick SKU is matched to specific sticks in the Sheet",
      "by tab, level, carbon, and size. Available stick counts are compared to stock_on_hand.",
      "",
      `Total Available Sticks in Sheet: ${diff.totalSheetAvailable}`,
      `Sticks Matched to SKUs: ${totalMappedCount}`,
      `Unmatched Sticks: ${diff.unmatchedSticks}`,
      "",
      `SKUs In Sync: ${diff.inSync.length}`,
      `SKUs With Discrepancies: ${diff.discrepancies.length}`,
      `Unmapped Stick SKUs in Inventory: ${diff.unmappedSkus.length}`,
      `Non-Stick Items (excluded): ${diff.nonStickItems}`,
    ];

    if (diff.discrepancies.length > 0) {
      sections.push(
        "",
        "### Stock Discrepancies (Sheet ≠ Inventory)",
        "The Sheet count is the source of truth. Inventory should be adjusted to match.",
        ""
      );
      for (const m of diff.discrepancies) {
        const direction = m.difference > 0 ? "UNDER-COUNTED" : "OVER-COUNTED";
        sections.push(
          `- **${m.sku}** — ${m.name}`,
          `  Sheet: ${m.sheetCount} available | Inventory: ${m.inventoryCount} on hand | Diff: ${m.difference > 0 ? "+" : ""}${m.difference} (${direction})`
        );
      }
    }

    if (diff.inSync.length > 0) {
      sections.push(
        "",
        "### In Sync",
        ...diff.inSync.map(
          (m) => `- **${m.sku}** — ${m.name}: ${m.sheetCount} units ✓`
        )
      );
    }

    if (diff.unmatchedSticks > 0) {
      sections.push(
        "",
        `### ⚠️ ${diff.unmatchedSticks} Available Sticks Not Matched to Any SKU`,
        "These sticks exist in the Sheet but didn't match any SKU filter.",
        "This may indicate new levels, carbons, or size ranges that need mapping."
      );
    }

    if (diff.unmappedSkus.length > 0) {
      sections.push(
        "",
        "### Unmapped Inventory SKUs",
        "These stick-like SKUs have no mapping defined. They may be legacy/discontinued.",
        ...diff.unmappedSkus.map(
          (i) => `- **${i.sku}** — ${i.name} (stock: ${i.stock_on_hand})`
        )
      );
    }

    return sections.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      "## ⚠️ Reconciliation Failed",
      "",
      `Error: ${msg}`,
      "",
      "This may be caused by:",
      "- Expired Zoho refresh token (needs both ZohoInventory and ZohoSheet scopes)",
      "- Missing ZOHO_SHEET_RESOURCE_ID env var",
      "- Incorrect worksheet tab names (expected: Player, Goalie)",
    ].join("\n");
  }
}

// ---- Apply: adjust Inventory stock to match the Sheet ---------------------

export interface AdjustmentResult {
  adjusted: { sku: string; name: string; from: number; to: number; diff: number; success: boolean; error?: string }[];
  errors: string[];
  adjustmentId?: string;
}

/**
 * Apply stock adjustments to Zoho Inventory so stock_on_hand matches
 * the master spreadsheet's available stick counts.
 *
 * Creates a single Zoho Inventory Adjustment with one line item per
 * discrepant SKU. Only adjusts mapped SKUs with differences.
 */
export async function applyStockAdjustments(): Promise<string> {
  const diff = await compareSheetToInventory();

  if (diff.discrepancies.length === 0) {
    const msg = diff.inSync.length > 0
      ? `All ${diff.inSync.length} mapped stick SKUs are already in sync.`
      : "No mapped SKUs found to adjust.";

    const sections = [
      "## Sheet → Inventory Sync: No Adjustments Needed",
      "",
      msg,
    ];

    if (diff.unmatchedSticks > 0) {
      sections.push(`\n⚠️ ${diff.unmatchedSticks} available sticks in the Sheet didn't match any SKU filter.`);
    }

    return sections.join("\n");
  }

  // Build line items for the adjustment
  const lineItems = diff.discrepancies.map((m) => ({
    item_id: m.itemId,
    quantity_adjusted: m.difference,
  }));

  const result: AdjustmentResult = {
    adjusted: [],
    errors: [],
  };

  const today = new Date().toISOString().slice(0, 10);

  try {
    const adjustment = await createInventoryAdjustment({
      date: today,
      reason: `Sheet sync ${today} (${diff.discrepancies.length} SKUs)`,
      line_items: lineItems,
    });

    result.adjustmentId = adjustment.inventory_adjustment_id;

    for (const m of diff.discrepancies) {
      result.adjusted.push({
        sku: m.sku,
        name: m.name,
        from: m.inventoryCount,
        to: m.sheetCount,
        diff: m.difference,
        success: true,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);

    for (const m of diff.discrepancies) {
      result.adjusted.push({
        sku: m.sku,
        name: m.name,
        from: m.inventoryCount,
        to: m.sheetCount,
        diff: m.difference,
        success: false,
        error: msg,
      });
    }
  }

  // Format the result report
  const sections: string[] = [
    "## Sheet → Inventory Sync Complete",
    "",
  ];

  if (result.adjustmentId) {
    const successCount = result.adjusted.filter((a) => a.success).length;
    const totalUnits = result.adjusted.reduce((sum, a) => sum + Math.abs(a.diff), 0);
    sections.push(
      `Adjustment ID: ${result.adjustmentId}`,
      `SKUs Adjusted: ${successCount}/${result.adjusted.length}`,
      `Total Units Adjusted: ${totalUnits}`,
      `Errors: ${result.errors.length}`,
      "",
      "### Adjustments Applied"
    );

    for (const a of result.adjusted) {
      if (a.success) {
        const dir = a.diff > 0 ? "+" : "";
        sections.push(`- ✅ **${a.sku}** — ${a.name}: ${a.from} → ${a.to} (${dir}${a.diff})`);
      } else {
        sections.push(`- ❌ **${a.sku}** — ${a.name}: ${a.error}`);
      }
    }
  } else {
    sections.push(
      `❌ Adjustment failed: ${result.errors.join(", ")}`,
      "",
      "### SKUs That Need Adjustment"
    );
    for (const a of result.adjusted) {
      const dir = a.diff > 0 ? "+" : "";
      sections.push(`- **${a.sku}** — ${a.name}: ${a.from} → ${a.to} (${dir}${a.diff})`);
    }
  }

  if (diff.unmatchedSticks > 0) {
    sections.push(
      "",
      `⚠️ ${diff.unmatchedSticks} available sticks in the Sheet didn't match any SKU filter — may need new mappings.`
    );
  }

  if (diff.inSync.length > 0) {
    sections.push(
      "",
      `${diff.inSync.length} other SKUs were already in sync — no changes needed.`
    );
  }

  return sections.join("\n");
}
