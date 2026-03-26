// ---------------------------------------------------------------------------
// zoho-sync.ts — Sheet → Inventory stock reconciliation
//
// The master Zoho Sheet tracks individual sticks by serial number.
// Zoho Inventory tracks stock at the SKU level (Level + Carbon combos).
//
// This module:
//   1. Reads individual sticks from the Sheet (Player + Goalie tabs)
//   2. Aggregates them by Level + Carbon into stock groups
//   3. Matches each group to a Zoho Inventory SKU
//   4. Compares available counts and reports discrepancies
//
// The Sheet is the source of truth for stick stock levels.
// Non-stick items (grips, apparel, accessories) live only in Inventory.
// ---------------------------------------------------------------------------

import {
  fetchAllStickRecords,
  aggregateStockGroups,
  buildGroupKey,
  type StockGroup,
} from "./zoho-sheet";
import {
  fetchAllItems,
  createInventoryAdjustment,
  type ZohoItem,
} from "./zoho";

// ---- Types ----------------------------------------------------------------

export interface StockMatch {
  group: StockGroup;
  inventoryItem: ZohoItem;
  sheetCount: number;
  inventoryCount: number;
  difference: number;
}

export interface SyncDiff {
  /** Groups that match an Inventory SKU and stock counts agree */
  inSync: StockMatch[];
  /** Groups that match an Inventory SKU but stock counts differ */
  discrepancies: StockMatch[];
  /** Sheet groups with no matching Inventory SKU */
  unmatchedSheet: StockGroup[];
  /** Stick-like Inventory items with no matching Sheet group */
  unmatchedInventory: ZohoItem[];
  /** Non-stick Inventory items (grips, apparel, etc.) — not in scope */
  nonStickItems: number;
}

// ---- SKU matching ---------------------------------------------------------

/**
 * Known SKU prefixes for non-stick product categories.
 * Items with these prefixes are NOT expected in the Sheet.
 */
const NON_STICK_PREFIXES = [
  "GRIP-",
  "T-S-",
  "HOO-",
  "HAT-",
  "SOC-",
  "BAG-",
  "TOW-",
  "BAN-",
  "STI-",
  "WAX-",
  "TAP-",
  "LAC-",
];

function isNonStickSku(sku: string): boolean {
  const upper = sku.toUpperCase();
  return NON_STICK_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * Try to match a Zoho Inventory item to a Level+Carbon group key.
 *
 * Strategy: check the item's name and SKU for level/carbon indicators.
 * For example:
 *   - Name "Intermediate 18K" → "INTERMEDIATE|18K"
 *   - SKU "INT-18K" → "INTERMEDIATE|18K"
 *   - Name "Junior 24K Carbon" → "JUNIOR|24K"
 */
function inferGroupKey(item: ZohoItem): string | null {
  const text = `${item.name} ${item.sku}`.toUpperCase();

  // Detect level
  let level = "";
  if (/\bINT(?:ERMEDIATE)?\b/.test(text)) level = "INTERMEDIATE";
  else if (/\bJR\b|\bJUN(?:IOR)?\b/.test(text)) level = "JUNIOR";
  else if (/\bSR\b|\bSEN(?:IOR)?\b/.test(text)) level = "SENIOR";
  else if (/\bGOAL(?:IE|TENDER)?\b/.test(text)) level = "GOALIE";

  // Detect carbon
  let carbon = "";
  if (/\b18K\b/.test(text)) carbon = "18K";
  else if (/\b24K\b/.test(text)) carbon = "24K";
  else if (/\b12K\b/.test(text)) carbon = "12K";
  else if (/\b30K\b/.test(text)) carbon = "30K";

  if (level && carbon) {
    return buildGroupKey(level, carbon);
  }

  return null;
}

// ---- Diff: compare sheet stock vs inventory -------------------------------

/**
 * Compare the master sheet stick counts against Zoho Inventory.
 * Does NOT make any changes — read-only comparison.
 */
export async function compareSheetToInventory(): Promise<SyncDiff> {
  const [sticks, inventoryItems] = await Promise.all([
    fetchAllStickRecords(),
    fetchAllItems(),
  ]);

  const groups = aggregateStockGroups(sticks);

  // Build a map of group key → StockGroup
  const groupByKey = new Map<string, StockGroup>();
  for (const group of groups) {
    groupByKey.set(group.groupKey, group);
  }

  // Try to match each inventory item to a group key
  const matchedGroupKeys = new Set<string>();
  const inSync: StockMatch[] = [];
  const discrepancies: StockMatch[] = [];
  const unmatchedInventory: ZohoItem[] = [];
  let nonStickItems = 0;

  for (const item of inventoryItems) {
    if (!item.sku) continue;

    // Skip non-stick items
    if (isNonStickSku(item.sku)) {
      nonStickItems++;
      continue;
    }

    const groupKey = inferGroupKey(item);
    if (!groupKey) {
      unmatchedInventory.push(item);
      continue;
    }

    const group = groupByKey.get(groupKey);
    if (!group) {
      unmatchedInventory.push(item);
      continue;
    }

    matchedGroupKeys.add(groupKey);

    const match: StockMatch = {
      group,
      inventoryItem: item,
      sheetCount: group.available,
      inventoryCount: item.stock_on_hand,
      difference: group.available - item.stock_on_hand,
    };

    if (match.difference === 0) {
      inSync.push(match);
    } else {
      discrepancies.push(match);
    }
  }

  // Sheet groups with no matching inventory item
  const unmatchedSheet = groups.filter((g) => !matchedGroupKeys.has(g.groupKey));

  return { inSync, discrepancies, unmatchedSheet, unmatchedInventory, nonStickItems };
}

// ---- Formatted output for prompt injection --------------------------------

/**
 * Run a full comparison and format the results as text for Claude.
 */
export async function fetchSyncReport(): Promise<string> {
  try {
    const diff = await compareSheetToInventory();

    const sections: string[] = [
      "## Sheet ↔ Inventory Stock Reconciliation Report",
      "",
      "The master spreadsheet tracks individual sticks by serial number.",
      "Stock counts are grouped by Level + Carbon and compared to Zoho Inventory SKUs.",
      "",
      `Matched & In Sync: ${diff.inSync.length} SKUs`,
      `Stock Discrepancies: ${diff.discrepancies.length} SKUs`,
      `Unmatched Sheet Groups (no Inventory SKU): ${diff.unmatchedSheet.length}`,
      `Unmatched Inventory SKUs (no Sheet group): ${diff.unmatchedInventory.length}`,
      `Non-Stick Items (grips, apparel, etc.): ${diff.nonStickItems} (not in scope)`,
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
          `- **${m.inventoryItem.sku}** — ${m.inventoryItem.name}`,
          `  Sheet: ${m.sheetCount} available | Inventory: ${m.inventoryCount} on hand | Diff: ${m.difference > 0 ? "+" : ""}${m.difference} (${direction})`
        );
      }
    }

    if (diff.inSync.length > 0) {
      sections.push(
        "",
        "### In Sync",
        ...diff.inSync.map(
          (m) => `- **${m.inventoryItem.sku}** — ${m.inventoryItem.name}: ${m.sheetCount} units ✓`
        )
      );
    }

    if (diff.unmatchedSheet.length > 0) {
      sections.push(
        "",
        "### Sheet Groups Without Inventory SKU",
        "These Level+Carbon combinations exist in the Sheet but could not be matched to any Zoho Inventory item.",
        "Action: Create the corresponding SKU in Zoho Inventory or update the SKU name to include Level + Carbon.",
        ...diff.unmatchedSheet.map(
          (g) => `- **${g.level} ${g.carbon}** — ${g.available} available sticks (${g.availableSerials.length} serials)`
        )
      );
    }

    if (diff.unmatchedInventory.length > 0) {
      sections.push(
        "",
        "### Stick SKUs Without Sheet Match",
        "These Inventory items look like sticks but could not be matched to a Sheet group.",
        "This may mean the SKU name/description doesn't contain recognizable Level + Carbon info.",
        ...diff.unmatchedInventory.map(
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
 * discrepant SKU. Only adjusts matched SKUs with differences — does
 * not create new items or touch unmatched/non-stick SKUs.
 */
export async function applyStockAdjustments(): Promise<string> {
  const diff = await compareSheetToInventory();

  if (diff.discrepancies.length === 0) {
    const msg = diff.inSync.length > 0
      ? `All ${diff.inSync.length} matched stick SKUs are already in sync.`
      : "No matched SKUs found to adjust.";

    const sections = [
      "## Sheet → Inventory Sync: No Adjustments Needed",
      "",
      msg,
    ];

    if (diff.unmatchedSheet.length > 0) {
      sections.push(`\n${diff.unmatchedSheet.length} Sheet groups have no matching Inventory SKU — these need to be created manually.`);
    }
    if (diff.unmatchedInventory.length > 0) {
      sections.push(`${diff.unmatchedInventory.length} Inventory stick SKUs couldn't be matched to a Sheet group.`);
    }

    return sections.join("\n");
  }

  // Build line items for the adjustment
  const lineItems = diff.discrepancies.map((m) => ({
    item_id: m.inventoryItem.item_id,
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
      reason: `Sheet reconciliation sync — ${diff.discrepancies.length} SKUs adjusted to match master spreadsheet (${today})`,
      line_items: lineItems,
    });

    result.adjustmentId = adjustment.inventory_adjustment_id;

    for (const m of diff.discrepancies) {
      result.adjusted.push({
        sku: m.inventoryItem.sku,
        name: m.inventoryItem.name,
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
        sku: m.inventoryItem.sku,
        name: m.inventoryItem.name,
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
    sections.push(
      `Adjustment ID: ${result.adjustmentId}`,
      `SKUs Adjusted: ${successCount}/${result.adjusted.length}`,
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

  if (diff.unmatchedSheet.length > 0) {
    sections.push(
      "",
      "### Still Unmatched (Manual Action Needed)",
      ...diff.unmatchedSheet.map(
        (g) => `- **${g.level} ${g.carbon}** — ${g.available} available sticks (no Inventory SKU exists)`
      )
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
