import type { KbConfig } from "@/lib/social/kb/config";

/**
 * Deterministic scheduling (Phase 2). No AI here — this lays down the LIVING
 * skeleton (6-month pillar allocations + pinned events) and expands the locked
 * 14-day window into concrete post slots. The brain (brain.ts) then writes copy
 * for each locked slot.
 */

export type Platform = "instagram" | "tiktok" | "facebook";

export type SkeletonWeek = {
  weekStart: string; // ISO date (Monday)
  pillarAllocations: Record<string, number>; // pillarKey -> count of pieces
  pinnedEvents: { label: string; note: string }[];
};

export type PostSlot = {
  date: string; // ISO date
  pillarId: number;
  pillarKey: string;
  pillarName: string;
  /** Platforms this content piece targets (IG primary, repurposed out). */
  platforms: Platform[];
  formatHint: "reel" | "static" | "carousel";
};

export function startOfWeekMonday(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0 Sun..6 Sat
  const diff = (day + 6) % 7; // days since Monday
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/**
 * Weighted round-robin: distribute `count` slots across pillars proportional to
 * their weights, deterministically (no randomness, so re-runs are stable).
 */
export function allocatePillars(
  count: number,
  cfg: KbConfig,
): { id: number; key: string; name: string }[] {
  const pillars = cfg.pillars;
  // Largest-remainder allocation by weight.
  const totalWeight = pillars.reduce((s, p) => s + p.weight, 0) || 1;
  const ideal = pillars.map((p) => (p.weight / totalWeight) * count);
  const base = ideal.map((x) => Math.floor(x));
  let remaining = count - base.reduce((s, x) => s + x, 0);
  const order = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && remaining > 0; k++) {
    base[order[k].i]++;
    remaining--;
  }
  // Expand to a list, interleaved so pillars don't clump.
  const buckets = pillars.map((p, i) => ({ p, n: base[i] }));
  const out: { id: number; key: string; name: string }[] = [];
  let more = true;
  while (more) {
    more = false;
    for (const b of buckets) {
      if (b.n > 0) {
        out.push({ id: b.p.id, key: b.p.key, name: b.p.name });
        b.n--;
        more = true;
      }
    }
  }
  return out.slice(0, count);
}

function eventsForWeek(weekStart: Date, cfg: KbConfig) {
  const wk = isoDate(weekStart).slice(0, 7); // YYYY-MM
  return cfg.calendar
    .filter((e) => e.date.startsWith(wk) || e.date.slice(0, 7) === wk)
    .map((e) => ({ label: e.label, note: e.note }));
}

/** Builds the rolling 6-month skeleton (26 weeks by default). */
export function buildSkeleton(
  from: Date,
  weeks: number,
  cfg: KbConfig,
): SkeletonWeek[] {
  const weeklyPieces = cfg.cadence.instagramPerWeek;
  const start = startOfWeekMonday(from);
  const out: SkeletonWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, w * 7);
    const alloc = allocatePillars(weeklyPieces, cfg);
    const counts: Record<string, number> = {};
    for (const p of alloc) counts[p.key] = (counts[p.key] ?? 0) + 1;
    out.push({
      weekStart: isoDate(ws),
      pillarAllocations: counts,
      pinnedEvents: eventsForWeek(ws, cfg),
    });
  }
  return out;
}

/**
 * Expands the locked window (default 14 days) into concrete post slots. Pieces
 * are spread across the days; platforms + format derive from the pillar and the
 * cadence (short video is the priority format).
 */
export function buildLockedSlots(from: Date, days: number, cfg: KbConfig): PostSlot[] {
  const start = startOfWeekMonday(from);
  const piecesPerWeek = cfg.cadence.instagramPerWeek;
  const weeks = Math.ceil(days / 7);
  const slots: PostSlot[] = [];

  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, w * 7);
    const pillars = allocatePillars(piecesPerWeek, cfg);
    // Spread pieces Mon/Tue/Wed/Thu/Fri-ish across the week.
    const dayOffsets = spread(piecesPerWeek);
    pillars.forEach((p, idx) => {
      const date = addDays(ws, dayOffsets[idx]);
      const isVideoPillar = p.key === "proof" || p.key === "athletes" || p.key === "community";
      const formatHint: PostSlot["formatHint"] = isVideoPillar
        ? "reel"
        : p.key === "fit" || p.key === "product"
          ? "carousel"
          : "static";
      const platforms: Platform[] =
        formatHint === "reel"
          ? ["instagram", "tiktok", "facebook"]
          : ["instagram", "facebook"];
      slots.push({
        date: isoDate(date),
        pillarId: p.id,
        pillarKey: p.key,
        pillarName: p.name,
        platforms,
        formatHint,
      });
    });
  }
  // Trim to the requested window.
  const end = addDays(startOfWeekMonday(from), days);
  return slots.filter((s) => new Date(s.date) < end);
}

/** Even-ish day offsets within a week for N pieces (Mon=0 .. Sun=6). */
function spread(n: number): number[] {
  const slotsByCount: Record<number, number[]> = {
    1: [1],
    2: [1, 3],
    3: [0, 2, 4],
    4: [0, 2, 3, 5],
    5: [0, 1, 3, 4, 6],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return slotsByCount[Math.min(Math.max(n, 1), 7)] ?? [0, 1, 2, 3, 4];
}
