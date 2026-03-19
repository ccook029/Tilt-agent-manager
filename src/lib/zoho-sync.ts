// ---------------------------------------------------------------------------
// zoho-sync.ts — Sheet → Inventory reconciliation
//
// The master Zoho Sheet is the source of truth. This module compares
// sheet products against Zoho Inventory items and produces a diff report.
// It can also apply changes (create/update items in Zoho Inventory).
//
// Architecture:
//   Sheet (source of truth) → compare → Zoho Inventory (operational system)
//   When the sheet says something different, Inventory gets updated.
// ---------------------------------------------------------------------------

import { fetchSheetProducts, type SheetProduct } from "./zoho-sheet";
import {
  fetchAllItems,
  createInventoryItem,
  updateInventoryItem,
  type ZohoItem,
} from "./zoho";

// ---- Types ----------------------------------------------------------------

export interface SyncDiff {
  /** Products in the sheet that don't exist in Zoho Inventory */
  toCreate: SheetProduct[];
  /** Products that exist in both but have field differences */
  toUpdate: {
    sheet: SheetProduct;
    inventory: ZohoItem;
    changes: string[];
  }[];
  /** Products in Zoho Inventory that aren't in the sheet */
  orphaned: ZohoItem[];
  /** Products that are fully in sync */
  inSync: number;
}

export interface SyncResult {
  created: { sku: string; name: string; success: boolean; error?: string }[];
  updated: { sku: string; name: string; changes: string[]; success: boolean; error?: string }[];
  errors: string[];
}

// ---- Diff: compare sheet vs inventory -------------------------------------

/**
 * Compare the master sheet against Zoho Inventory and produce a diff.
 * Does NOT make any changes — read-only comparison.
 */
export async function compareSheetToInventory(): Promise<SyncDiff> {
  const [sheetProducts, inventoryItems] = await Promise.all([
    fetchSheetProducts(),
    fetchAllItems(),
  ]);

  // Index inventory items by SKU for fast lookup
  const inventoryBySku = new Map<string, ZohoItem>();
  for (const item of inventoryItems) {
    if (item.sku) {
      inventoryBySku.set(item.sku.toUpperCase(), item);
    }
  }

  // Track which inventory SKUs we've matched
  const matchedSkus = new Set<string>();

  const toCreate: SheetProduct[] = [];
  const toUpdate: SyncDiff["toUpdate"] = [];
  let inSync = 0;

  for (const product of sheetProducts) {
    const skuKey = product.sku.toUpperCase();
    const inventoryItem = inventoryBySku.get(skuKey);

    if (!inventoryItem) {
      toCreate.push(product);
      continue;
    }

    matchedSkus.add(skuKey);

    // Compare fields
    const changes: string[] = [];

    if (product.name && product.name !== inventoryItem.name) {
      changes.push(`name: "${inventoryItem.name}" → "${product.name}"`);
    }
    if (product.rate > 0 && product.rate !== inventoryItem.rate) {
      changes.push(`rate: $${inventoryItem.rate} → $${product.rate}`);
    }
    if (product.purchase_rate > 0 && product.purchase_rate !== inventoryItem.purchase_rate) {
      changes.push(`purchase_rate: $${inventoryItem.purchase_rate} → $${product.purchase_rate}`);
    }
    if (product.reorder_level > 0 && product.reorder_level !== inventoryItem.reorder_level) {
      changes.push(`reorder_level: ${inventoryItem.reorder_level} → ${product.reorder_level}`);
    }
    if (product.unit && product.unit !== inventoryItem.unit) {
      changes.push(`unit: "${inventoryItem.unit}" → "${product.unit}"`);
    }

    if (changes.length > 0) {
      toUpdate.push({ sheet: product, inventory: inventoryItem, changes });
    } else {
      inSync++;
    }
  }

  // Find orphaned items (in Inventory but not in the sheet)
  const sheetSkus = new Set(sheetProducts.map((p) => p.sku.toUpperCase()));
  const orphaned = inventoryItems.filter(
    (item) => item.sku && !sheetSkus.has(item.sku.toUpperCase())
  );

  return { toCreate, toUpdate, orphaned, inSync };
}

// ---- Apply: sync inventory to match the sheet -----------------------------

/**
 * Apply the diff — create missing items and update mismatched fields
 * in Zoho Inventory to match the master sheet.
 *
 * Respects Zoho's rate limit of 100 requests/min by throttling.
 */
export async function applySyncToInventory(
  diff: SyncDiff
): Promise<SyncResult> {
  const result: SyncResult = {
    created: [],
    updated: [],
    errors: [],
  };

  // Create missing items
  for (const product of diff.toCreate) {
    try {
      await createInventoryItem({
        name: product.name,
        sku: product.sku,
        rate: product.rate,
        purchase_rate: product.purchase_rate,
        reorder_level: product.reorder_level,
        unit: product.unit || "qty",
        description: product.description,
      });
      result.created.push({ sku: product.sku, name: product.name, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.created.push({ sku: product.sku, name: product.name, success: false, error: msg });
      result.errors.push(`Create ${product.sku}: ${msg}`);
    }
    // Throttle to stay under Zoho's 100 req/min limit
    await sleep(700);
  }

  // Update mismatched items
  for (const { sheet, inventory, changes } of diff.toUpdate) {
    try {
      const updates: Record<string, unknown> = {};
      if (sheet.name && sheet.name !== inventory.name) updates.name = sheet.name;
      if (sheet.rate > 0 && sheet.rate !== inventory.rate) updates.rate = sheet.rate;
      if (sheet.purchase_rate > 0 && sheet.purchase_rate !== inventory.purchase_rate)
        updates.purchase_rate = sheet.purchase_rate;
      if (sheet.reorder_level > 0 && sheet.reorder_level !== inventory.reorder_level)
        updates.reorder_level = sheet.reorder_level;
      if (sheet.unit && sheet.unit !== inventory.unit) updates.unit = sheet.unit;

      await updateInventoryItem(inventory.item_id, updates);
      result.updated.push({ sku: sheet.sku, name: sheet.name, changes, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.updated.push({ sku: sheet.sku, name: sheet.name, changes, success: false, error: msg });
      result.errors.push(`Update ${sheet.sku}: ${msg}`);
    }
    await sleep(700);
  }

  return result;
}

// ---- Formatted output for prompt injection --------------------------------

/**
 * Run a full comparison and format the results as text for Claude.
 * Does NOT apply changes — just reports the diff.
 */
export async function fetchSyncReport(): Promise<string> {
  try {
    const diff = await compareSheetToInventory();

    const sections: string[] = [
      "## Sheet ↔ Inventory Reconciliation Report",
      "",
      `In Sync: ${diff.inSync} SKUs`,
      `Need to Create in Inventory: ${diff.toCreate.length}`,
      `Need to Update in Inventory: ${diff.toUpdate.length}`,
      `Orphaned in Inventory (not in sheet): ${diff.orphaned.length}`,
    ];

    if (diff.toCreate.length > 0) {
      sections.push(
        "",
        "### New Items (in Sheet, missing from Inventory)",
        ...diff.toCreate.map(
          (p) => `- **${p.sku}** — ${p.name} (rate: $${p.rate}, reorder: ${p.reorder_level})`
        )
      );
    }

    if (diff.toUpdate.length > 0) {
      sections.push("", "### Items Needing Updates");
      for (const { sheet, changes } of diff.toUpdate) {
        sections.push(`- **${sheet.sku}** — ${sheet.name}`);
        for (const change of changes) {
          sections.push(`  - ${change}`);
        }
      }
    }

    if (diff.orphaned.length > 0) {
      sections.push(
        "",
        "### Orphaned Items (in Inventory, not in Sheet)",
        "These items exist in Zoho Inventory but are NOT in the master spreadsheet.",
        "Review whether they should be added to the sheet or deactivated.",
        ...diff.orphaned.map(
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
      "- Incorrect worksheet name",
    ].join("\n");
  }
}

/**
 * Run the full sync: compare then apply changes to Zoho Inventory.
 * Returns a formatted report of what was done.
 */
export async function runSheetToInventorySync(): Promise<string> {
  const diff = await compareSheetToInventory();

  if (diff.toCreate.length === 0 && diff.toUpdate.length === 0) {
    return [
      "## Sheet → Inventory Sync: Already in Sync",
      "",
      `All ${diff.inSync} SKUs match between the master spreadsheet and Zoho Inventory.`,
      diff.orphaned.length > 0
        ? `\n${diff.orphaned.length} orphaned items in Inventory are not in the sheet — review for potential cleanup.`
        : "",
    ].join("\n");
  }

  const result = await applySyncToInventory(diff);

  const sections: string[] = [
    "## Sheet → Inventory Sync Complete",
    "",
    `Created: ${result.created.filter((r) => r.success).length}/${result.created.length}`,
    `Updated: ${result.updated.filter((r) => r.success).length}/${result.updated.length}`,
    `Errors: ${result.errors.length}`,
  ];

  if (result.created.length > 0) {
    sections.push("", "### Created Items");
    for (const r of result.created) {
      sections.push(
        r.success
          ? `- ✅ ${r.sku} — ${r.name}`
          : `- ❌ ${r.sku} — ${r.name}: ${r.error}`
      );
    }
  }

  if (result.updated.length > 0) {
    sections.push("", "### Updated Items");
    for (const r of result.updated) {
      sections.push(
        r.success
          ? `- ✅ ${r.sku} — ${r.name} (${r.changes.join(", ")})`
          : `- ❌ ${r.sku} — ${r.name}: ${r.error}`
      );
    }
  }

  if (diff.orphaned.length > 0) {
    sections.push(
      "",
      "### Orphaned Items (action needed)",
      ...diff.orphaned.map((i) => `- ${i.sku} — ${i.name} (stock: ${i.stock_on_hand})`)
    );
  }

  return sections.join("\n");
}

// ---- Helpers --------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
