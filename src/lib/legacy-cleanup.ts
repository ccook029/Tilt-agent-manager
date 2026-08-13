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
}

/** True for items this module is allowed to touch: an active, TILT-prefixed
 *  stick SKU that is NOT one of the 12 live ones. */
function isLegacyStick(item: ZohoItem): boolean {
  if (!item.sku) return false;
  const sku = item.sku.toUpperCase();
  if (!sku.startsWith("TILT-")) return false; // non-stick catalog (grips, apparel…)
  if (ACTIVE_SKUS.has(sku)) return false; // the live sticks
  return item.status === "active";
}

/**
 * Every legacy stick SKU still active in Zoho, phantom stock and all.
 * Sorted with the worst offenders (most phantom stock) first.
 */
export async function listLegacyStickItems(): Promise<LegacyStickItem[]> {
  const items = await fetchAllItems();
  return items
    .filter(isLegacyStick)
    .map((i) => ({
      itemId: i.item_id,
      sku: i.sku,
      name: i.name,
      stockOnHand: i.stock_on_hand,
      phantomValue: Math.round(i.stock_on_hand * (i.purchase_rate ?? 0) * 100) / 100,
    }))
    .sort((a, b) => b.stockOnHand - a.stockOnHand);
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
          "Not a retirable item — either an active stick SKU, a non-stick item, already inactive, or an unknown id.",
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
