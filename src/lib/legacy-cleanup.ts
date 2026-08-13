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
  createInventoryAdjustment,
  markItemInactive,
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
 * Deactivating doesn't clear a count, so a retired item can sit at -8 forever
 * and keep skewing every valuation and reorder. Separate from
 * retireLegacyItems because that function only handles active items by design.
 *
 * Whether Zoho accepts an adjustment against an inactive item isn't something
 * this can assume, so the error comes back verbatim rather than being reported
 * as success.
 */
export async function zeroInactiveStock(
  items: { itemId: string; sku: string; stockOnHand: number }[]
): Promise<{ zeroed: number; unitsCleared: number; error?: string }> {
  const withStock = items.filter((i) => i.stockOnHand !== 0);
  if (withStock.length === 0) return { zeroed: 0, unitsCleared: 0 };

  try {
    await createInventoryAdjustment({
      date: new Date().toISOString().slice(0, 10),
      reason: "Clear stock on retired items",
      line_items: withStock.map((i) => ({
        item_id: i.itemId,
        quantity_adjusted: -i.stockOnHand,
      })),
    });
    return {
      zeroed: withStock.length,
      unitsCleared: withStock.reduce((s, i) => s + Math.abs(i.stockOnHand), 0),
    };
  } catch (err) {
    return {
      zeroed: 0,
      unitsCleared: 0,
      error: err instanceof Error ? err.message : String(err),
    };
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
