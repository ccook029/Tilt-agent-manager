// ---------------------------------------------------------------------------
// preorder-writer.ts — turn a factory batch into sellable rows on the sheet.
//
// A batch is held as quantities per spec ("12 × Senior 66in 24K, due Sept 15")
// because that's the only way to track sticks that have no serial yet. But the
// storefront doesn't sell quantities, it sells ROWS: one line on the inventory
// sheet per physical stick, found by its Serial Number. So to make a batch
// buyable, it has to be expanded — 212 sticks become 212 rows.
//
// Each row gets a `PROD-nnnn` placeholder in the Serial Number column. That's
// the whole mechanism: every lookup in both apps already goes through that
// column, so a pre-order behaves exactly like a stick on the shelf for the
// cart, the checkout guard and the sold-flip, with no new column and no schema
// change. When the stick lands, the real serial is written over the
// placeholder and the row becomes ordinary stock.
// ---------------------------------------------------------------------------
import { appendSheetRows, fetchAllStickRecords } from "./zoho-sheet";
import { listBatches, type ProductionBatch, type ProductionLine } from "./production-batches";
import {
  formatPreorderId,
  listPreorderRows,
  nextPreorderNumber,
  recordPreorderRows,
  type PreorderRow,
} from "./preorder-rows";
import { specKey } from "./production-batches";

export const PREORDER_STATUS = "In Production";

/** Goalie sticks live on their own tab, same as they do for real stock. */
function tabFor(line: ProductionLine): string {
  return /goalie/i.test(line.level) ? "Goalie" : "Player";
}

export interface WriteResult {
  written: number;
  preorderIds: string[];
  /** Already on the sheet from an earlier run — batches are written once. */
  alreadyWritten: number;
}

/**
 * Write one sellable row per outstanding stick in a batch.
 *
 * Idempotent per batch: rows already written for this batch are counted and
 * skipped rather than duplicated. Clicking the button twice must not put 424
 * sticks on the storefront.
 */
export async function writePreorderRows(batchId: string): Promise<WriteResult> {
  const batches = await listBatches();
  const batch = batches.find((b) => b.id === batchId);
  if (!batch) throw new Error(`No production batch ${batchId}.`);
  if (batch.closedAt) throw new Error(`${batch.label} is closed — nothing outstanding.`);

  // How many rows this batch already has, per spec, so a re-run tops up rather
  // than doubling. Keyed on spec because that's what a batch line is.
  const index = await listPreorderRows();
  const existingBySpec = new Map<string, number>();
  for (const row of Object.values(index)) {
    if (row.batchId !== batchId) continue;
    existingBySpec.set(row.specKey, (existingBySpec.get(row.specKey) ?? 0) + 1);
  }

  // Read the live sheet first. If it can't be read we must not write: a blind
  // append is how you end up with a second copy of every stick.
  try {
    await fetchAllStickRecords();
  } catch (err) {
    throw new Error(
      `Refusing to write — the live sheet couldn't be read first: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  let next = await nextPreorderNumber();
  const byTab = new Map<string, Record<string, string>[]>();
  const recorded: PreorderRow[] = [];
  let alreadyWritten = 0;

  for (const line of batch.lines) {
    const key = specKey(line);
    const outstanding = Math.max(0, line.quantity - line.received);
    const have = existingBySpec.get(key) ?? 0;
    alreadyWritten += Math.min(have, outstanding);
    const toWrite = Math.max(0, outstanding - have);

    for (let i = 0; i < toWrite; i++) {
      const preorderId = formatPreorderId(next++);
      const tab = tabFor(line);
      const rows = byTab.get(tab) ?? [];
      rows.push({
        Level: line.level,
        "Size (inch)": line.size,
        Carbon: line.carbon,
        "Kick Point": line.kickPoint,
        Hand: line.hand,
        Flex: line.flex,
        Curve: line.curve,
        "Base Color": line.baseColor,
        "Decal Color": line.decalColor,
        "Serial Number": preorderId,
        Status: PREORDER_STATUS,
        "Date Sold": "",
      });
      byTab.set(tab, rows);
      recorded.push({
        preorderId,
        batchId,
        tab,
        specKey: key,
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (recorded.length === 0) return { written: 0, preorderIds: [], alreadyWritten };

  let written = 0;
  for (const [tab, rows] of byTab) {
    const { added } = await appendSheetRows(tab, rows);
    written += added;
  }

  // Recorded only after the sheet accepted them, so a failed write doesn't
  // leave the index claiming rows that aren't there.
  await recordPreorderRows(recorded);

  return { written, preorderIds: recorded.map((r) => r.preorderId), alreadyWritten };
}

/** What a batch would put on the sheet, without writing — for the button's
 *  confirm step, so nobody discovers the count after the fact. */
export async function previewPreorderRows(
  batchId: string
): Promise<{ batch: ProductionBatch; toWrite: number; alreadyWritten: number }> {
  const batches = await listBatches();
  const batch = batches.find((b) => b.id === batchId);
  if (!batch) throw new Error(`No production batch ${batchId}.`);

  const index = await listPreorderRows();
  const existingBySpec = new Map<string, number>();
  for (const row of Object.values(index)) {
    if (row.batchId !== batchId) continue;
    existingBySpec.set(row.specKey, (existingBySpec.get(row.specKey) ?? 0) + 1);
  }

  let toWrite = 0;
  let alreadyWritten = 0;
  for (const line of batch.lines) {
    const outstanding = Math.max(0, line.quantity - line.received);
    const have = existingBySpec.get(specKey(line)) ?? 0;
    alreadyWritten += Math.min(have, outstanding);
    toWrite += Math.max(0, outstanding - have);
  }
  return { batch, toWrite, alreadyWritten };
}
