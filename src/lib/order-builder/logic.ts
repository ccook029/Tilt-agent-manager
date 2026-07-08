// ---------------------------------------------------------------------------
// Order Builder "logic" — the explainability layer.
//
// Two consumers:
//   • Stockton's chat: renderOrderBuilderContext() gives him the allocator's
//     methodology + live demand/stock aggregates, so he can discuss HOW a
//     recommendation was derived (cached ~10 min; chat shouldn't hammer Zoho).
//   • The "Order Logic" PDF: generateOrderLogic() has Stockton write a
//     narrative for a specific drafted order — what was looked at, why the
//     split/specs/quantities came out the way they did — for the PO packet.
// ---------------------------------------------------------------------------
import { callClaude } from "@/lib/anthropic";
import { buildDemand, type Constraints, type GoalieLine, type OrderDataset, type SpecLine } from "./allocator";
import { buildOrderDataset } from "./data";

/** How the allocator actually works — keep in sync with allocator.ts. */
export const ALLOCATOR_METHODOLOGY = `The Stick Order Builder derives a factory order from live data, deterministically:
1. LEVEL SPLIT — defaults to each level's share of lifetime units ordered (all sticks ever run through the Zoho sheet). Plain-language steering can override it (e.g. "skew 60% senior").
2. SIZES — within a level, lengths are weighted by (lifetime demand at that length) × (stockout risk ^ stock-awareness). Stockout risk = lifetime sold ÷ (currently available + 1), so thin or empty lengths get boosted when stock-awareness is on (default 0.5).
3. SPECS — flex, curve, hand, and kick distributions come from what actually sold at that level+length. A flex bias (e.g. "lower flex") exponentially re-weights toward that end of the range. "Variety" controls how many distinct flex/curve combos per length.
4. COLORWAYS — each line gets one of that length's best-selling base/decal combinations, assigned proportionally to demand.
5. COMMITTED CUSTOMS — the pending queue from the tiltweb admin (status new/downloaded) rides on top of the target quantity; they are customer commitments, not discretionary stock.
6. ECONOMICS — landed cost = factory ex-ship CAD + $7 air (JR 48-52" $53 / JR 54"+ $58 / INT+SR $85, 24K premium; goalie per paddle $122-$132 from the Huizhou PI). Revenue at the chosen channel (DTC = MSRP, Team -15%, Wholesale -30%, SFS tiered).
Rounding then nudges line quantities so the total hits the target exactly.`;

/** Deterministic aggregates snapshot — the numbers behind any recommendation. */
export function summarizeDataset(data: OrderDataset): string {
  const D = buildDemand(data);
  const lines: string[] = [];

  const totalLifetime = Object.values(D.byLevel).reduce((s, v) => s + v, 0) || 1;
  lines.push("Lifetime demand by level (basis of the default split):");
  for (const lvl of ["Senior", "Intermediate", "Junior"]) {
    const n = D.byLevel[lvl] || 0;
    lines.push(`  ${lvl}: ${n} units (${Math.round((n / totalLifetime) * 100)}%)`);
  }

  lines.push("Per length — lifetime sold vs on-hand (stockout risk drives extra weight):");
  const sizeKeys = Object.keys(D.bySize).sort((a, b) => (D.bySize[b] || 0) - (D.bySize[a] || 0));
  for (const sk of sizeKeys.slice(0, 12)) {
    const [lvl, sz] = sk.split("|");
    const sold = D.bySize[sk] || 0;
    const avail = D.availBySize[sk] || 0;
    const risk = (sold / (avail + 1)).toFixed(1);
    lines.push(`  ${lvl} ${sz}": ${sold} lifetime, ${avail} on hand (risk ${risk})`);
  }

  const goalieLifetime = data.goalie.lifetime_orders.reduce((s, g) => s + g.qty, 0);
  const goalieAvail = data.goalie.inventory.reduce((s, g) => s + g.qty, 0);
  lines.push(`Goalie: ${goalieLifetime} lifetime units, ${goalieAvail} on hand.`);

  const customCount =
    data.custom.player.reduce((s, c) => s + c.qty, 0) +
    data.custom.goalie.reduce((s, c) => s + c.qty, 0);
  lines.push(`Pending custom-order queue (admin, rides on top of any target): ${customCount} sticks.`);
  if (data.warnings.length) {
    lines.push(`Data warnings this run: ${data.warnings.join(" | ")}`);
  }
  return lines.join("\n");
}

// ── Stockton chat context (cached; chat must not hammer Zoho per message) ──
let cachedContext: { at: number; text: string } | null = null;
const CONTEXT_TTL_MS = 10 * 60 * 1000;

export async function renderOrderBuilderContext(): Promise<string> {
  if (cachedContext && Date.now() - cachedContext.at < CONTEXT_TTL_MS) {
    return cachedContext.text;
  }
  try {
    const data = await buildOrderDataset();
    const text = `

# Your Stick Order Builder (Inventory → Order Builder in HQ)
You own this tool. When the team asks how an order recommendation was derived, explain it from the methodology and the live numbers below — concretely, citing the actual figures.

## Methodology
${ALLOCATOR_METHODOLOGY}

## Live numbers (as of ${data.generated_at.slice(0, 16).replace("T", " ")})
${summarizeDataset(data)}`;
    cachedContext = { at: Date.now(), text };
    return text;
  } catch (err) {
    console.warn("[order-builder] chat context unavailable:", err);
    return "";
  }
}

// ── The "Order Logic" narrative for a specific drafted order ──
export interface OrderLogicInput {
  player: SpecLine[];
  goalie: GoalieLine[];
  targetQty: number;
  channel: string;
  carbonPref: string;
  constraints: Constraints;
  includeCustom: boolean;
  totals: { units: number; cost: number; rev: number; margin: number };
}

export async function generateOrderLogic(input: OrderLogicInput): Promise<string> {
  const data = await buildOrderDataset();

  const orderLines = input.player
    .map(
      (l) =>
        `${l.level} ${l.size}" ${l.carbon} flex ${l.flex} ${l.curve} ${l.hand[0]} ${l.baseColor}/${l.decalColor} × ${l.qty}`
    )
    .concat(
      input.goalie.map(
        (g) => `Goalie ${g.paddle}" ${g.hand[0]} ${g.baseColor}/${g.decalColor} × ${g.qty}`
      )
    )
    .join("\n");

  const res = await callClaude({
    systemPrompt: `You are Stockton Ledger, Tilt Hockey's Director of Inventory Operations. You are writing the "Order Logic" memo that accompanies a factory purchase order, so the team (and anyone reviewing later) understands exactly how this order was derived. Write in first person, confident and concrete, citing real numbers from the data provided. Structure it with these markdown sections:
# Order Logic — how I built this order
## What I looked at (data sources: lifetime sales from the stick sheet, current on-hand stock, the pending custom-order queue, steering instructions)
## The level split and why
## Lengths, flexes, and curves (tie choices to demand + stockout risk, name the thin/stocked-out lengths)
## Colorways
## Committed custom orders
## Economics (landed cost, expected revenue at the channel, margin)
## What I'd watch (honest caveats: assumptions, thin data, anything steered manually)
Keep it under 900 words. Never invent numbers — everything must come from the provided data. If steering constraints overrode the defaults, say so explicitly.`,
    userMessage: `## Methodology (how the allocator works)
${ALLOCATOR_METHODOLOGY}

## Live data snapshot
${summarizeDataset(data)}

## Parameters for THIS order
Target: ${input.targetQty} sticks · Channel: ${input.channel} · Carbon: ${input.carbonPref} · Custom queue included: ${input.includeCustom ? "yes" : "no"}
Steering constraints in effect: ${JSON.stringify(input.constraints)}

## The drafted order (${input.totals.units} units, ${input.player.length + input.goalie.length} lines)
${orderLines}

## Totals
Landed cost $${Math.round(input.totals.cost).toLocaleString("en-CA")} CAD · Revenue @ channel $${Math.round(input.totals.rev).toLocaleString("en-CA")} · Gross margin $${Math.round(input.totals.margin).toLocaleString("en-CA")}

Write the Order Logic memo now.`,
    maxTokens: 2000,
    temperature: 0.3,
  });

  return res.text;
}
