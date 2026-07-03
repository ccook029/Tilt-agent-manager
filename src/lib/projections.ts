// ---------------------------------------------------------------------------
// projections.ts — forward revenue projection from the expected-contracts
// pipeline. Deterministic (no model call): Sterling reasons over the numbers.
//
// Three lines per month:
//   committed — only deals marked "won"
//   weighted  — every deal, probability-weighted (won=100%, lost=0%)
//   best      — every non-lost deal at 100% (the ceiling)
//
// Recognition: one-time deals land in their start month; monthly deals add
// their amount each month over the term; annual deals spread as amount/12 per
// month over the term (default 12 months). This is a revenue view, not a
// cash-timing view — Sterling flags the difference when it matters.
// ---------------------------------------------------------------------------
import { type ExpectedContract, weightOf } from "./expected-contracts";

export interface MonthPoint {
  month: string; // YYYY-MM
  committed: number;
  weighted: number;
  best: number;
}

export interface Projection {
  months: MonthPoint[];
  horizonMonths: number;
  totals: { committed: number; weighted: number; best: number };
  generatedAt: string;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(from: Date, target: Date): number {
  return (
    (target.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - from.getUTCMonth())
  );
}

export function buildProjection(
  contracts: ExpectedContract[],
  horizonMonths = 12,
  from: Date = new Date()
): Projection {
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const months: MonthPoint[] = Array.from({ length: horizonMonths }, (_, i) => ({
    month: monthKey(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1))),
    committed: 0,
    weighted: 0,
    best: 0,
  }));

  for (const c of contracts) {
    if (c.status === "lost") continue;
    const start = new Date(c.expectedStart);
    if (isNaN(start.getTime())) continue;
    const startIdx = monthIndex(base, start);
    const term = c.cadence === "one-time" ? 1 : Math.max(1, c.termMonths ?? 12);
    const perMonth =
      c.cadence === "one-time"
        ? c.amount
        : c.cadence === "annual"
          ? c.amount / 12
          : c.amount;

    const weight = weightOf(c);
    for (let k = 0; k < term; k++) {
      const idx = startIdx + k;
      if (idx < 0 || idx >= horizonMonths) continue;
      const pt = months[idx];
      pt.best += perMonth;
      pt.weighted += perMonth * weight;
      if (c.status === "won") pt.committed += perMonth;
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  for (const m of months) {
    m.committed = round(m.committed);
    m.weighted = round(m.weighted);
    m.best = round(m.best);
  }

  const totals = months.reduce(
    (acc, m) => ({
      committed: round(acc.committed + m.committed),
      weighted: round(acc.weighted + m.weighted),
      best: round(acc.best + m.best),
    }),
    { committed: 0, weighted: 0, best: 0 }
  );

  return {
    months,
    horizonMonths,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

/** Compact text summary for injecting into Sterling's prompt / reports. */
export function renderProjectionSummary(p: Projection): string {
  if (p.months.every((m) => m.best === 0)) {
    return "(no expected contracts logged yet — projections will populate as Chris adds pipeline deals)";
  }
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const lines = p.months.map(
    (m) => `${m.month}: committed ${fmt(m.committed)} · weighted ${fmt(m.weighted)} · best ${fmt(m.best)}`
  );
  return [
    `Projected revenue over the next ${p.horizonMonths} months (from the expected-contracts pipeline):`,
    ...lines,
    `TOTAL — committed ${fmt(p.totals.committed)} · probability-weighted ${fmt(p.totals.weighted)} · best-case ${fmt(p.totals.best)}`,
  ].join("\n");
}
