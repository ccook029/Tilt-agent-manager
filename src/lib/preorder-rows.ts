// ---------------------------------------------------------------------------
// preorder-rows.ts — the link between a factory batch and the sheet rows it
// created.
//
// A pre-order stick gets a real row on the inventory sheet the moment the batch
// is placed: Status "In Production", and a `PROD-nnnn` placeholder sitting in
// the Serial Number column where the real serial will go when it lands. That
// placeholder is the whole trick — every lookup in both apps already goes
// through the Serial Number column, so a pre-order behaves like any other stick
// for the cart, the checkout guard and the sold-flip, with no schema change
// anywhere and no new column on the sheet.
//
// What the sheet CAN'T say is when the stick is due. That date belongs to the
// batch and it moves: Piers slips a date and all 212 sticks slip with it.
// Copying it into a column would mean 212 cells to correct every time. So the
// sheet is the list and HQ stays the schedule — this index maps each
// placeholder back to its batch, and the storefront asks for the dates.
//
// It also survives the handover. When a real serial is written over a
// placeholder on a row that has ALREADY been sold, the order still references
// `PROD-0042` — so the mapping is kept here rather than overwritten, and
// "which physical stick went to that order" stays answerable.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { listBatches } from "./production-batches";

const KEY = "preorder-rows";

export const PREORDER_PREFIX = "PROD-";

export interface PreorderRow {
  /** The placeholder written into the sheet's Serial Number column. */
  preorderId: string;
  batchId: string;
  /** Which sheet tab the row was written to ("Player" | "Goalie"). */
  tab: string;
  /** Spec key, so an arriving stick can be matched back to its row. */
  specKey: string;
  createdAt: string;
  /** The real serial, once the stick has landed and the row was updated. */
  serial?: string;
  receivedAt?: string;
}

export type PreorderIndex = Record<string, PreorderRow>;

export async function listPreorderRows(): Promise<PreorderIndex> {
  try {
    return (await kv.get<PreorderIndex>(KEY)) ?? {};
  } catch {
    return {};
  }
}

async function save(index: PreorderIndex): Promise<void> {
  await kv.set(KEY, index);
}

/** Next free placeholder number, so ids never collide with a retired batch. */
export async function nextPreorderNumber(): Promise<number> {
  const index = await listPreorderRows();
  let max = 0;
  for (const id of Object.keys(index)) {
    const n = Number(id.slice(PREORDER_PREFIX.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export function formatPreorderId(n: number): string {
  return `${PREORDER_PREFIX}${String(n).padStart(4, "0")}`;
}

export async function recordPreorderRows(rows: PreorderRow[]): Promise<void> {
  const index = await listPreorderRows();
  for (const r of rows) index[r.preorderId] = r;
  await save(index);
}

/**
 * A pre-ordered stick has arrived and its row now carries a real serial.
 *
 * The mapping is UPDATED, not deleted: if the stick was sold before it landed,
 * the customer's order still references the placeholder, and this is the only
 * place that can still tie the two together.
 */
export async function markPreorderReceived(
  preorderId: string,
  serial: string
): Promise<boolean> {
  const index = await listPreorderRows();
  const row = index[preorderId.trim().toUpperCase()];
  if (!row) return false;
  row.serial = serial;
  row.receivedAt = new Date().toISOString();
  await save(index);
  return true;
}

/** Look up which physical stick fulfilled a pre-order. */
export async function serialForPreorder(
  preorderId: string
): Promise<string | null> {
  const index = await listPreorderRows();
  return index[preorderId.trim().toUpperCase()]?.serial ?? null;
}

/**
 * preorder id → expected ISO date, for the storefront badge.
 *
 * Only rows still waiting on a stick are included. Once the real serial has
 * been written the row is an ordinary in-stock stick and must stop advertising
 * a delivery estimate.
 */
export async function preorderExpectedDates(): Promise<Record<string, string>> {
  const [index, batches] = await Promise.all([listPreorderRows(), listBatches()]);
  const dateByBatch = new Map(batches.map((b) => [b.id, b.expectedDate]));
  const out: Record<string, string> = {};
  for (const [id, row] of Object.entries(index)) {
    if (row.serial) continue;
    const date = dateByBatch.get(row.batchId);
    if (date) out[id] = date;
  }
  return out;
}

/**
 * Re-point rows after their spec changed (e.g. a base colour was filled in).
 *
 * The stored specKey is what an arriving stick matches against, so it has to
 * follow the batch line or the shipment won't find these rows. Rows that
 * already have a serial are left alone — they're finished, and rewriting their
 * key would only muddy the record of what fulfilled what.
 */
export async function respecPreorderRows(
  batchId: string,
  oldSpecKey: string,
  newSpecKey: string
): Promise<PreorderRow[]> {
  const index = await listPreorderRows();
  const moved: PreorderRow[] = [];
  for (const row of Object.values(index)) {
    if (row.batchId !== batchId || row.specKey !== oldSpecKey || row.serial) continue;
    row.specKey = newSpecKey;
    moved.push(row);
  }
  if (moved.length > 0) await save(index);
  return moved;
}
