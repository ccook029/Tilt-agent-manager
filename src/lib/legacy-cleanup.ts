// ---------------------------------------------------------------------------
// legacy-cleanup.ts — retire legacy stick SKUs that show stock we don't have.
//
// Zoho Inventory carries ~200 SKUs but only 12 active stick SKUs (the ones
// mapped to the master sheet). The rest are old models — Canuck, Phenom,
// Beast, retired variants — many still showing phantom stock_on_hand that
// makes every inventory view lie. Retiring one means: zero its stock via a
// normal inventory adjustment (audit trail preserved), then mark the item
// inactive so it drops out of the active catalog. Both steps are reversible
// from the Zoho UI.
//
// Safety: the 12 active SKUs can never be retired through this module, no
// matter what item ids a caller passes — the guard re-derives the legacy set
// from live Zoho data on every call.
// ---------------------------------------------------------------------------
import {
  fetchAllItems,
  fetchItem,
  createInventoryAdjustment,
  markItemInactive,
  markItemActive,
  type ZohoItem,
} from "./zoho";
import { SKU_FILTERS } from "./zoho-sync";
import { postSignal } from "./signals";

const ACTIVE_SKUS = new Set(Object.keys(SKU_FILTERS).map((s) => s.toUpperCase()));

export interface LegacyStickItem {
  itemId: string;
  sku: string;
  name: string;
  stockOnHand: number;
  /** stock × purchase rate — what the phantom stock claims to be worth. */
  phantomValue: number;
  /** Zoho's own grouping, to help tell an old stick from a grip. */
  category: string;
  /** Whether the SKU uses the current TILT- convention. Legacy models
   *  generally predate it, so this is a hint, never a filter. */
  tiltSku: boolean;
}

/**
 * True for anything this module may touch: any ACTIVE item that isn't one of
 * the 12 live stick SKUs.
 *
 * Deliberately not narrower. The first cut required a "TILT-" prefix on the
 * theory that legacy sticks shared it; they don't — the retired models
 * predate that convention, so the page came back empty on a catalog full of
 * them. Anything cleverer is a guess about naming, and a guess that silently
 * hides items is worse than a list the owner reads. So: show the whole
 * catalog minus the untouchables, label what we can, and let the human pick.
 */
function isRetirable(item: ZohoItem): boolean {
  if (item.status !== "active") return false;
  if (item.sku && ACTIVE_SKUS.has(item.sku.toUpperCase())) return false;
  return true;
}

/**
 * Every active item that could be retired, worst phantom stock first.
 * Read-only — this is the list the button would act on.
 */
export async function listLegacyStickItems(): Promise<LegacyStickItem[]> {
  const items = await fetchAllItems();
  return items
    .filter(isRetirable)
    .map((i) => ({
      itemId: i.item_id,
      sku: i.sku || "(no SKU)",
      name: i.name,
      stockOnHand: i.stock_on_hand,
      phantomValue: Math.round(i.stock_on_hand * (i.purchase_rate ?? 0) * 100) / 100,
      category: i.category_name || i.group_name || "—",
      tiltSku: !!i.sku && i.sku.toUpperCase().startsWith("TILT-"),
    }))
    // By distance from zero, so negative stock — the loudest sign an item is
    // dead — surfaces alongside the big positive counts instead of sinking to
    // the bottom of the list.
    .sort((a, b) => Math.abs(b.stockOnHand) - Math.abs(a.stockOnHand));
}

/**
 * Zero the stock of items that are already inactive.
 *
 * Deactivating never cleared a count, so a retired item can sit at -8 forever
 * and keep skewing every valuation and reorder.
 *
 * Zoho won't let that be fixed in place: it refuses adjustments against
 * inactive items ("cannot be raised for item … marked as inactive", code
 * 2007) and won't report their stock either. The only route is to bring each
 * item back, correct it, and retire it again — so that is what this does, and
 * the re-retire runs in a finally, because leaving an item visible in the
 * catalog is the one outcome worse than leaving its count wrong.
 */
export async function zeroInactiveStock(
  items: { itemId: string; sku: string }[]
): Promise<{
  zeroed: number;
  unitsCleared: number;
  skipped: number;
  error?: string;
  /** Items left ACTIVE because re-retiring them failed. Loud on purpose:
   *  these are visible in the catalog until someone deactivates them. */
  leftActive: string[];
}> {
  const reactivated: { itemId: string; sku: string }[] = [];
  const leftActive: string[] = [];
  let skipped = 0;

  if (items.length === 0) {
    return { zeroed: 0, unitsCleared: 0, skipped: 0, leftActive };
  }

  try {
    for (const item of items) {
      try {
        await markItemActive(item.itemId);
        reactivated.push(item);
      } catch {
        skipped++; // couldn't bring it back; its count stays as-is
      }
    }

    // Stock only became readable once the items were active again.
    const lines: { item_id: string; quantity_adjusted: number }[] = [];
    let unitsCleared = 0;
    for (const item of reactivated) {
      try {
        const full = await fetchItem(item.itemId);
        const stock = Number(full.stock_on_hand);
        if (!Number.isFinite(stock) || stock === 0) continue;
        lines.push({ item_id: item.itemId, quantity_adjusted: -stock });
        unitsCleared += Math.abs(stock);
      } catch {
        skipped++;
      }
    }

    if (lines.length === 0) {
      return { zeroed: 0, unitsCleared: 0, skipped, leftActive };
    }

    await createInventoryAdjustment({
      date: new Date().toISOString().slice(0, 10),
      reason: "Clear stock on retired items",
      line_items: lines,
    });

    return { zeroed: lines.length, unitsCleared, skipped, leftActive };
  } catch (err) {
    return {
      zeroed: 0,
      unitsCleared: 0,
      skipped,
      error: err instanceof Error ? err.message : String(err),
      leftActive,
    };
  } finally {
    // Put every item back the way it was found, success or failure.
    for (const item of reactivated) {
      try {
        await markItemInactive(item.itemId);
      } catch {
        leftActive.push(item.sku);
      }
    }
  }
}

export interface RetireResult {
  itemId: string;
  sku: string;
  name: string;
  stockZeroed: number;
  zeroed: boolean;
  deactivated: boolean;
  error?: string;
}

/**
 * Zero the stock of the given legacy items and mark them inactive.
 *
 * Ids that don't resolve to a legacy stick are rejected per-item rather than
 * failing the batch — the caller sees exactly which ones were refused and why.
 * The adjustment is one document covering every item with non-zero stock, so
 * the Zoho audit trail shows the cleanup as a single named event.
 */
export async function retireLegacyItems(
  itemIds: string[]
): Promise<RetireResult[]> {
  const legacy = new Map((await listLegacyStickItems()).map((i) => [i.itemId, i]));
  const results: RetireResult[] = [];
  const toProcess: LegacyStickItem[] = [];

  for (const id of itemIds) {
    const item = legacy.get(id);
    if (!item) {
      results.push({
        itemId: id,
        sku: "?",
        name: "?",
        stockZeroed: 0,
        zeroed: false,
        deactivated: false,
        error:
          "Not a retirable item — either one of the 12 live stick SKUs, already inactive, or an unknown id.",
      });
      continue;
    }
    toProcess.push(item);
  }

  // One adjustment for everything that has stock to zero. Positive or
  // negative, the correction is the same: adjust by -stock to land on 0.
  const withStock = toProcess.filter((i) => i.stockOnHand !== 0);
  let adjustmentOk = withStock.length === 0;
  let adjustmentError: string | undefined;
  if (withStock.length > 0) {
    try {
      await createInventoryAdjustment({
        date: new Date().toISOString().slice(0, 10),
        reason: "Retire legacy stick SKUs — phantom stock cleanup",
        line_items: withStock.map((i) => ({
          item_id: i.itemId,
          quantity_adjusted: -i.stockOnHand,
        })),
      });
      adjustmentOk = true;
    } catch (err) {
      adjustmentError = err instanceof Error ? err.message : String(err);
    }
  }

  for (const item of toProcess) {
    const neededZeroing = item.stockOnHand !== 0;
    const zeroed = !neededZeroing || adjustmentOk;

    // Never deactivate an item whose stock we failed to zero — an inactive
    // item with phantom stock is strictly harder to find and fix.
    let deactivated = false;
    let error = zeroed ? undefined : `stock not zeroed: ${adjustmentError}`;
    if (zeroed) {
      try {
        await markItemInactive(item.itemId);
        deactivated = true;
      } catch (err) {
        error = `zeroed but not deactivated: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    results.push({
      itemId: item.itemId,
      sku: item.sku,
      name: item.name,
      stockZeroed: neededZeroing && zeroed ? item.stockOnHand : 0,
      zeroed,
      deactivated,
      error,
    });
  }

  const retired = results.filter((r) => r.deactivated).length;
  const unitsZeroed = results.reduce((s, r) => s + r.stockZeroed, 0);
  if (retired > 0) {
    await postSignal({
      source: "inventory",
      headline: `Retired ${retired} legacy stick SKU${retired === 1 ? "" : "s"} — ${unitsZeroed} phantom units zeroed`,
      detail: results
        .filter((r) => r.deactivated)
        .map((r) => `${r.sku} (${r.stockZeroed} units)`)
        .join(", "),
    }).catch(() => {});
  }

  return results;
}
