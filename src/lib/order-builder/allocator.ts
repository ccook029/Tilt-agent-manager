// ---------------------------------------------------------------------------
// Stick Order Builder — allocator + economics (isomorphic: page + API share it).
//
// Ported from the standalone Order Builder v3. Builds a factory-order
// recommendation from Stockton's live demand data: level mix from lifetime
// orders, sizes weighted by demand × stockout risk, spec distributions
// (flex/curve/hand/kick) from what actually sells, steered by plain-language
// constraints. Player sticks get the full spec allocator; goalies are a
// separate paddle-size × hand allocation.
// ---------------------------------------------------------------------------

export interface SpecLine {
  level: "Junior" | "Intermediate" | "Senior";
  size: number;
  carbon: "18K" | "24K";
  kick: string;
  hand: "Left" | "Right";
  flex: number;
  curve: string;
  qty: number;
}

export interface GoalieLine {
  paddle: number;
  hand: "Left" | "Right";
  qty: number;
}

export interface ComboRow {
  level: string;
  size: number;
  carbon: string;
  kick: string;
  hand: string;
  flex: number;
  curve: string;
  qty: number; // lifetime units for lifetime_orders; available for inventory
}

export interface GoalieComboRow {
  paddle: number;
  hand: string;
  qty: number;
}

export interface OrderDataset {
  generated_at: string;
  source: string;
  player: { inventory: ComboRow[]; lifetime_orders: ComboRow[] };
  goalie: { inventory: GoalieComboRow[]; lifetime_orders: GoalieComboRow[] };
  warnings: string[];
}

export interface Constraints {
  level_mix: { Senior?: number; Intermediate?: number; Junior?: number } | null;
  flex_bias: "low" | "high" | null;
  flex_bias_strength: number; // 0–1
  variety: "low" | "medium" | "high";
  curve_exclude: string[];
  curve_include: string[] | null;
  hand_mix: { Left: number; Right: number } | null;
  stock_awareness: number; // 0–1
  /** Share of the target that goes to goalie sticks (0–0.3). */
  goalie_share: number;
}

export const DEFAULT_CONSTRAINTS: Constraints = {
  level_mix: null,
  flex_bias: null,
  flex_bias_strength: 0.6,
  variety: "medium",
  curve_exclude: [],
  curve_include: null,
  hand_mix: null,
  stock_awareness: 0.5,
  goalie_share: 0.05,
};

export type Channel = "dtc" | "team" | "wholesale" | "sfs";
export type CarbonPref = "18K" | "mix" | "24K";

/* ---------- SPEC SPACE (from the Tilt product spec) ---------- */
export const FLEX: Record<SpecLine["level"], number[]> = {
  Junior: [15, 20, 25, 30, 35, 40, 45, 50],
  Intermediate: [40, 45, 50, 55, 60, 65],
  Senior: [65, 70, 75, 80, 85, 90, 95, 100, 105, 110],
};
export const SIZES: Record<SpecLine["level"], number[]> = {
  Junior: [48, 50, 52, 54, 56, 58],
  Intermediate: [58, 60, 62, 63],
  Senior: [64, 66, 68, 70, 72],
};
export const CURVES = ["T92", "T28", "T88", "T91A", "T90", "T02"];
export const GOALIE_PADDLES = [21, 22, 23, 24, 25, 26, 27];

/* ---------- ECONOMICS (CAD) ----------
   COGS = factory ex-ship + air landed. Mid-weight-tier defaults — weight-per-
   SKU is an OPEN DECISION; update here when locked. Goalie factory cost is NOT
   locked either: goalie lines show MSRP but are excluded from cost/margin. */
export const LANDED_ADDER = 7;
export const COGS = {
  jrShort: { k18: 53, k24: 58 }, // 48–52"
  jrLong: { k18: 58, k24: 64 }, // 54–59"
  int: { k18: 85, k24: 93 },
  sr: { k18: 85, k24: 93 },
};
export const MSRP: Record<SpecLine["level"], Record<"18K" | "24K", number>> = {
  Junior: { "18K": 165, "24K": 185 },
  Intermediate: { "18K": 215, "24K": 235 },
  Senior: { "18K": 265, "24K": 285 },
};

export function srSurcharge(size: number): number {
  return size >= 72 ? 20 : size >= 68 ? 10 : 0;
}
export function unitCost(l: SpecLine): number {
  let b: { k18: number; k24: number };
  if (l.level === "Junior") b = l.size <= 52 ? COGS.jrShort : COGS.jrLong;
  else if (l.level === "Intermediate") b = COGS.int;
  else b = COGS.sr;
  return (l.carbon === "24K" ? b.k24 : b.k18) + LANDED_ADDER;
}
export function unitMsrp(l: SpecLine): number {
  return MSRP[l.level][l.carbon] + (l.level === "Senior" ? srSurcharge(l.size) : 0);
}
/** Goalie MSRP by paddle (matches the storefront's pricing). */
export function goalieMsrp(paddle: number): number {
  if (paddle <= 22) return 195;
  if (paddle <= 24) return 245;
  return 285;
}
export function channelPrice(msrp: number, level: SpecLine["level"] | "Goalie", ch: Channel): number {
  if (ch === "dtc") return msrp;
  if (ch === "team") return msrp * 0.85;
  if (ch === "wholesale") return msrp * 0.7;
  // SFS tiered: SR 48% off, INT 43%, JR 45% (goalie treated as SR tier).
  const off = level === "Intermediate" ? 0.43 : level === "Junior" ? 0.45 : 0.48;
  return msrp * (1 - off);
}

/* ---------- DEMAND MODEL ---------- */
interface Demand {
  byLevel: Record<string, number>;
  bySize: Record<string, number>; // "Level|size" → lifetime qty
  availBySize: Record<string, number>;
  specs: Record<
    string,
    { flex: Record<string, number>; curve: Record<string, number>; hand: Record<string, number>; kick: Record<string, number> }
  >;
}

export function buildDemand(data: OrderDataset): Demand {
  const byLevel: Demand["byLevel"] = {};
  const bySize: Demand["bySize"] = {};
  const availBySize: Demand["availBySize"] = {};
  const specs: Demand["specs"] = {};
  for (const o of data.player.lifetime_orders) {
    byLevel[o.level] = (byLevel[o.level] || 0) + o.qty;
    const sk = `${o.level}|${o.size}`;
    bySize[sk] = (bySize[sk] || 0) + o.qty;
    if (!specs[sk]) specs[sk] = { flex: {}, curve: {}, hand: {}, kick: {} };
    specs[sk].flex[o.flex] = (specs[sk].flex[o.flex] || 0) + o.qty;
    if (o.curve) specs[sk].curve[o.curve] = (specs[sk].curve[o.curve] || 0) + o.qty;
    if (o.hand) specs[sk].hand[o.hand] = (specs[sk].hand[o.hand] || 0) + o.qty;
    if (o.kick) specs[sk].kick[o.kick] = (specs[sk].kick[o.kick] || 0) + o.qty;
  }
  for (const o of data.player.inventory) {
    const sk = `${o.level}|${o.size}`;
    availBySize[sk] = (availBySize[sk] || 0) + o.qty;
  }
  return { byLevel, bySize, availBySize, specs };
}

export function stockFlag(
  data: OrderDataset,
  level: string,
  size: number
): [label: string, tone: "risk" | "hot" | "cover"] {
  let s = 0,
    a = 0;
  for (const o of data.player.lifetime_orders) if (o.level === level && o.size === size) s += o.qty;
  for (const o of data.player.inventory) if (o.level === level && o.size === size) a += o.qty;
  if (a === 0) return ["STOCKOUT", "risk"];
  if (s / a > 4) return ["THIN", "hot"];
  return [a > s * 0.6 ? "COVERED" : "OK", "cover"];
}

/* ---------- ALLOCATOR ---------- */
function pickWeighted(
  dist: Record<string, number>,
  n: number,
  biasFn?: (k: string) => number
): [string, number][] {
  let entries = Object.entries(dist).map(
    ([k, v]) => [k, v * (biasFn ? biasFn(k) : 1)] as [string, number]
  );
  entries.sort((a, b) => b[1] - a[1]);
  entries = entries.filter((e) => e[1] > 0).slice(0, n);
  const tot = entries.reduce((s, e) => s + e[1], 0) || 1;
  return entries.map((e) => [e[0], e[1] / tot]);
}

function flexBiasFn(level: SpecLine["level"], c: Constraints): ((f: string) => number) | undefined {
  if (!c.flex_bias) return undefined;
  const range = FLEX[level];
  const lo = range[0],
    hi = range[range.length - 1];
  const k = c.flex_bias_strength * 3;
  return (f) => {
    const t = (Number(f) - lo) / (hi - lo); // 0 = lowest flex
    return c.flex_bias === "low" ? Math.exp(-k * t) : Math.exp(-k * (1 - t));
  };
}

export function allocate(
  data: OrderDataset,
  targetTotal: number,
  carbonPref: CarbonPref,
  c: Constraints
): { player: SpecLine[]; goalie: GoalieLine[] } {
  const goalieQty = Math.round(targetTotal * Math.min(Math.max(c.goalie_share, 0), 0.3));
  const target = Math.max(0, targetTotal - goalieQty);
  const D = buildDemand(data);
  const levels: SpecLine["level"][] = ["Senior", "Intermediate", "Junior"];

  // 1. level split — steered mix, else lifetime demand share.
  let mix: Record<string, number> = {};
  if (c.level_mix) mix = { ...c.level_mix } as Record<string, number>;
  else {
    const tot = levels.reduce((s, l) => s + (D.byLevel[l] || 0), 0) || 1;
    levels.forEach((l) => (mix[l] = (D.byLevel[l] || 0) / tot));
  }
  const msum = levels.reduce((s, l) => s + (mix[l] || 0), 0) || 1;
  levels.forEach((l) => (mix[l] = (mix[l] || 0) / msum));

  // 2. per level → sizes by demand × coverage; per size → spec combos.
  const varietyN = c.variety === "high" ? 4 : c.variety === "low" ? 1 : 2;
  const lines: SpecLine[] = [];
  for (const level of levels) {
    const lvlQty = Math.round(target * (mix[level] || 0));
    if (lvlQty <= 0) continue;
    const sizeDist: Record<string, number> = {};
    for (const sz of SIZES[level]) {
      const sk = `${level}|${sz}`;
      const demand = D.bySize[sk] || 0;
      if (demand > 0) {
        const avail = D.availBySize[sk] || 0;
        const risk = demand / (avail + 1);
        sizeDist[sz] = demand * Math.pow(Math.max(risk, 0.1), c.stock_awareness);
      }
    }
    if (Object.keys(sizeDist).length === 0)
      sizeDist[SIZES[level][Math.floor(SIZES[level].length / 2)]] = 1;
    const sizePicks = pickWeighted(sizeDist, c.variety === "high" ? 6 : 4);

    for (const [szStr, sw] of sizePicks) {
      const sz = Number(szStr);
      const sk = `${level}|${sz}`;
      const sp = D.specs[sk] || { flex: {}, curve: {}, hand: {}, kick: {} };

      let curveDist = { ...sp.curve };
      if (c.curve_include)
        Object.keys(curveDist).forEach((cv) => {
          if (!c.curve_include!.includes(cv)) delete curveDist[cv];
        });
      c.curve_exclude.forEach((cv) => delete curveDist[cv]);
      if (Object.keys(curveDist).length === 0) curveDist = { T92: 2, T88: 1 };

      const flexDist = { ...sp.flex };
      if (Object.keys(flexDist).length === 0) {
        flexDist[FLEX[level][Math.floor(FLEX[level].length / 2)]] = 1;
      }

      const flexPicks = pickWeighted(flexDist, varietyN, flexBiasFn(level, c));
      const curvePicks = pickWeighted(curveDist, Math.min(varietyN, 2));
      const handMix =
        c.hand_mix ??
        (() => {
          const h = sp.hand;
          const t = (h.Left || 0) + (h.Right || 0);
          return t
            ? { Left: (h.Left || 0) / t, Right: (h.Right || 0) / t }
            : { Left: 0.6, Right: 0.4 };
        })();
      const kick =
        Object.entries(sp.kick).sort((a, b) => b[1] - a[1])[0]?.[0] || "Mid";

      const szQty = lvlQty * sw;
      for (const [fx, fw] of flexPicks) {
        for (const [cv, cw] of curvePicks) {
          for (const hand of ["Left", "Right"] as const) {
            const q = Math.round(szQty * fw * cw * (handMix[hand] || 0));
            if (q > 0) {
              const carbon: SpecLine["carbon"] =
                carbonPref === "24K"
                  ? "24K"
                  : carbonPref === "mix" && level === "Senior" && Math.random() < 0.3
                    ? "24K"
                    : "18K";
              lines.push({ level, size: sz, carbon, kick, hand, flex: Number(fx), curve: cv, qty: q });
            }
          }
        }
      }
    }
  }

  // 3. rounding correction to hit the player target exactly.
  let diff = target - lines.reduce((s, l) => s + l.qty, 0);
  lines.sort((a, b) => b.qty - a.qty);
  let i = 0;
  while (diff !== 0 && lines.length) {
    lines[i % lines.length].qty += Math.sign(diff);
    if (lines[i % lines.length].qty < 1) lines[i % lines.length].qty = 1;
    diff = target - lines.reduce((s, l) => s + l.qty, 0);
    i++;
    if (i > 2000) break;
  }

  return {
    player: lines.filter((l) => l.qty > 0),
    goalie: allocateGoalie(data, goalieQty),
  };
}

/** Goalie allocation: paddle × hand weighted by lifetime demand (with floor). */
export function allocateGoalie(data: OrderDataset, qty: number): GoalieLine[] {
  if (qty <= 0) return [];
  const dist: Record<string, number> = {};
  for (const o of data.goalie.lifetime_orders) {
    if (!o.paddle) continue;
    const k = `${o.paddle}|${o.hand || "Left"}`;
    dist[k] = (dist[k] || 0) + o.qty;
  }
  if (Object.keys(dist).length === 0) {
    dist["24|Left"] = 2;
    dist["25|Right"] = 1;
  }
  const picks = pickWeighted(dist, 4);
  const lines: GoalieLine[] = picks.map(([k, w]) => {
    const [paddle, hand] = k.split("|");
    return { paddle: Number(paddle), hand: hand as GoalieLine["hand"], qty: Math.round(qty * w) };
  });
  // rounding correction
  let diff = qty - lines.reduce((s, l) => s + l.qty, 0);
  let i = 0;
  while (diff !== 0 && lines.length) {
    lines[i % lines.length].qty += Math.sign(diff);
    if (lines[i % lines.length].qty < 1) lines[i % lines.length].qty = 1;
    diff = qty - lines.reduce((s, l) => s + l.qty, 0);
    i++;
    if (i > 500) break;
  }
  return lines.filter((l) => l.qty > 0);
}
