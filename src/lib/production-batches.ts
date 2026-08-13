// ---------------------------------------------------------------------------
// production-batches.ts — sticks that exist at the factory but not yet here.
//
// Why these can't just be rows on the inventory sheet: that sheet is one row
// per PHYSICAL stick, keyed on serial number, and a row counts as sellable
// only when its Status reads Available. Sticks in production have no serial
// yet. Writing serial-less rows there would break the intake dedupe, corrupt
// the per-SKU reconciliation counts, and leave rows that can never be matched
// to the real sticks when they land.
//
// So production stock is held as QUANTITIES PER SPEC — "12 × Senior 66in 24K
// T92M flex 85 Black/Halo, due Sept 15" — which is also the only sane way to
// link them later. You cannot match on a serial that does not exist yet, so
// the shipment is matched on the spec and draws the outstanding count down.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "production-batches";

export interface ProductionSpec {
  level: string;
  size: string;
  carbon: string;
  kickPoint: string;
  hand: string;
  flex: string;
  curve: string;
  baseColor: string;
  decalColor: string;
}

export interface ProductionLine extends ProductionSpec {
  /** How many of this exact spec were ordered. */
  quantity: number;
  /** How many have since arrived and been matched to real serials. */
  received: number;
}

export interface ProductionBatch {
  id: string;
  /** What the owner calls it — "Sept factory order". */
  label: string;
  /** ISO date the sticks are expected to be sellable. */
  expectedDate: string;
  createdAt: string;
  createdBy: string;
  lines: ProductionLine[];
  /** Set when every line is fully received, so a finished batch stops
   *  competing for matches. */
  closedAt?: string;
}

/**
 * The key a received stick is matched on. Case and spacing vary between the
 * factory's list and the count sheet, so both sides are flattened the same
 * way — otherwise "Left" and "left" look like different sticks and the batch
 * never draws down.
 */
export function specKey(s: Partial<ProductionSpec>): string {
  const norm = (v?: string) =>
    String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return [
    norm(s.level),
    norm(s.size),
    norm(s.carbon),
    norm(s.kickPoint),
    norm(s.hand),
    norm(s.flex),
    norm(s.curve),
    norm(s.baseColor),
    norm(s.decalColor),
  ].join("|");
}

export function describeSpec(s: ProductionSpec): string {
  return [
    s.level,
    s.size ? `${s.size}"` : "",
    s.carbon,
    s.flex ? `Flex ${s.flex}` : "",
    s.curve,
    s.hand,
    [s.baseColor, s.decalColor].filter(Boolean).join(" / "),
  ]
    .filter(Boolean)
    .join(" · ");
}

/* ── Storage ──────────────────────────────────────────────────────────── */

export async function listBatches(): Promise<ProductionBatch[]> {
  try {
    return (await kv.get<ProductionBatch[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

async function saveBatches(batches: ProductionBatch[]): Promise<void> {
  await kv.set(KEY, batches);
}

export async function addBatch(
  batch: Omit<ProductionBatch, "id" | "createdAt">
): Promise<ProductionBatch> {
  const batches = await listBatches();
  const created: ProductionBatch = {
    ...batch,
    id: `prod-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  await saveBatches([...batches, created]);
  return created;
}

export async function deleteBatch(id: string): Promise<boolean> {
  const batches = await listBatches();
  const next = batches.filter((b) => b.id !== id);
  if (next.length === batches.length) return false;
  await saveBatches(next);
  return true;
}

export async function updateBatchDate(
  id: string,
  expectedDate: string
): Promise<boolean> {
  const batches = await listBatches();
  const b = batches.find((x) => x.id === id);
  if (!b) return false;
  b.expectedDate = expectedDate;
  await saveBatches(batches);
  return true;
}

/* ── Outstanding ──────────────────────────────────────────────────────── */

export interface OutstandingLine extends ProductionLine {
  batchId: string;
  batchLabel: string;
  expectedDate: string;
  outstanding: number;
}

/** Everything still to arrive, oldest expected date first. */
export async function outstandingLines(): Promise<OutstandingLine[]> {
  const batches = await listBatches();
  const out: OutstandingLine[] = [];
  for (const b of batches) {
    if (b.closedAt) continue;
    for (const l of b.lines) {
      const outstanding = Math.max(0, l.quantity - l.received);
      if (outstanding === 0) continue;
      out.push({
        ...l,
        batchId: b.id,
        batchLabel: b.label,
        expectedDate: b.expectedDate,
        outstanding,
      });
    }
  }
  return out.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
}

export interface MatchResult {
  /** Serial → the batch line it was matched against. */
  matched: { serial: string; batchId: string; spec: string }[];
  /** Received sticks that matched no outstanding production line. Not an
   *  error — stock arrives that was never on a batch — but worth saying so a
   *  spec mismatch doesn't hide as a silent non-match. */
  unmatched: { serial: string; spec: string }[];
}

/**
 * Draw down production quantities for sticks that have just arrived.
 *
 * Matched oldest-expected-first so a delayed batch clears before a newer one,
 * which is what someone reading "due Sept 15" would assume. Only ever reduces
 * the outstanding count — the real stick is recorded on the inventory sheet by
 * the intake flow, and this is purely the "no longer waiting on it" side.
 */
export async function receiveAgainstProduction(
  sticks: (ProductionSpec & { serial: string })[]
): Promise<MatchResult> {
  const batches = await listBatches();
  const matched: MatchResult["matched"] = [];
  const unmatched: MatchResult["unmatched"] = [];

  // Oldest expected date first, so the batch that has been waiting longest is
  // satisfied before a newer one takes the stick.
  const open = batches
    .filter((b) => !b.closedAt)
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  for (const stick of sticks) {
    const key = specKey(stick);
    let hit = false;
    for (const b of open) {
      const line = b.lines.find(
        (l) => specKey(l) === key && l.received < l.quantity
      );
      if (line) {
        line.received++;
        matched.push({ serial: stick.serial, batchId: b.id, spec: describeSpec(stick) });
        hit = true;
        break;
      }
    }
    if (!hit) unmatched.push({ serial: stick.serial, spec: describeSpec(stick) });
  }

  // A batch with nothing left outstanding stops competing for matches.
  for (const b of open) {
    if (b.lines.every((l) => l.received >= l.quantity)) {
      b.closedAt = new Date().toISOString();
    }
  }

  await saveBatches(batches);
  return { matched, unmatched };
}

/** Roll a list of per-stick rows into quantities per spec. */
export function aggregateLines(
  rows: (ProductionSpec & { quantity?: number })[]
): ProductionLine[] {
  const map = new Map<string, ProductionLine>();
  for (const r of rows) {
    const key = specKey(r);
    const qty = Math.max(1, Number(r.quantity) || 1);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += qty;
      continue;
    }
    map.set(key, {
      level: r.level ?? "",
      size: r.size ?? "",
      carbon: r.carbon ?? "",
      kickPoint: r.kickPoint ?? "",
      hand: r.hand ?? "",
      flex: r.flex ?? "",
      curve: r.curve ?? "",
      baseColor: r.baseColor ?? "",
      decalColor: r.decalColor ?? "",
      quantity: qty,
      received: 0,
    });
  }
  return [...map.values()];
}
