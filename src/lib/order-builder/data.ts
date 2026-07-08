// ---------------------------------------------------------------------------
// Stick Order Builder — live dataset from Stockton's Zoho stick sheet.
//
// Replaces the standalone tool's stockton_inventory.json export: instead of a
// daily file, we build the same contract on demand from the sheet the hub
// already reads (Player + Goalie tabs). lifetime_orders = every unit ever in
// the sheet (each row is one stick ordered from the factory), aggregated per
// spec combo; inventory = rows currently status "Available".
//
// Normalization (the contract is strict; the sheet is human-entered):
//   • level → Junior | Intermediate | Senior (case/abbreviation tolerant)
//   • flex snapped to nearest 5 (warning logged when we had to snap)
//   • kick → Low | Mid | High; hand → Left | Right
// Anything that can't be normalized is skipped with a warning — surfaced in
// the payload so a bad sheet edit fails loudly, not silently.
// ---------------------------------------------------------------------------
import { fetchAllStickRecords, type StickRecord } from "@/lib/zoho-sheet";
import type { ComboRow, GoalieComboRow, OrderDataset } from "./allocator";

function normLevel(raw: string): "Junior" | "Intermediate" | "Senior" | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith("jr") || t.startsWith("jun")) return "Junior";
  if (t.startsWith("int")) return "Intermediate";
  if (t.startsWith("sr") || t.startsWith("sen")) return "Senior";
  return null;
}
function normHand(raw: string): "Left" | "Right" | null {
  const t = raw.trim().toLowerCase();
  if (t.startsWith("l")) return "Left";
  if (t.startsWith("r")) return "Right";
  return null;
}
function normKick(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (t.includes("low")) return "Low";
  if (t.includes("high")) return "High";
  if (t.includes("mid")) return "Mid";
  return "Mid";
}
function snapFlex(raw: number): { flex: number; snapped: boolean } {
  const flex = Math.round(raw / 5) * 5;
  return { flex, snapped: flex !== raw };
}

function comboKey(r: Omit<ComboRow, "qty">): string {
  return [r.level, r.size, r.carbon, r.kick, r.hand, r.flex, r.curve].join("|");
}

export async function buildOrderDataset(): Promise<OrderDataset> {
  const records = await fetchAllStickRecords();
  const warnings: string[] = [];
  let snappedCount = 0;

  const playerLifetime = new Map<string, ComboRow>();
  const playerAvail = new Map<string, ComboRow>();
  const goalieLifetime = new Map<string, GoalieComboRow>();
  const goalieAvail = new Map<string, GoalieComboRow>();

  const add = (map: Map<string, ComboRow>, row: Omit<ComboRow, "qty">) => {
    const k = comboKey(row);
    const cur = map.get(k);
    if (cur) cur.qty += 1;
    else map.set(k, { ...row, qty: 1 });
  };
  const addGoalie = (map: Map<string, GoalieComboRow>, paddle: number, hand: string) => {
    const k = `${paddle}|${hand}`;
    const cur = map.get(k);
    if (cur) cur.qty += 1;
    else map.set(k, { paddle, hand, qty: 1 });
  };

  for (const r of records as StickRecord[]) {
    const isGoalie = r.tab.toLowerCase().includes("goalie");
    const available = r.status.trim().toLowerCase() === "available";

    if (isGoalie) {
      const paddle = Math.round(r.size);
      const hand = normHand(r.hand) ?? "Left";
      if (!paddle) continue;
      addGoalie(goalieLifetime, paddle, hand);
      if (available) addGoalie(goalieAvail, paddle, hand);
      continue;
    }

    const level = normLevel(r.level);
    const hand = normHand(r.hand);
    if (!level || !r.size || !r.flex) {
      warnings.push(
        `Skipped Player row ${r.row_index} (level="${r.level}", size=${r.size}, flex=${r.flex}) — couldn't normalize.`
      );
      continue;
    }
    const { flex, snapped } = snapFlex(r.flex);
    if (snapped) snappedCount++;
    const row: Omit<ComboRow, "qty"> = {
      level,
      size: Math.round(r.size),
      carbon: r.carbon.trim().toUpperCase() || "18K",
      kick: normKick(r.kick_point),
      hand: hand ?? "Left",
      flex,
      curve: r.curve.trim().toUpperCase(),
    };
    add(playerLifetime, row);
    if (available) add(playerAvail, row);
  }

  if (snappedCount > 0) {
    warnings.push(`Snapped ${snappedCount} off-increment flex value(s) to the nearest 5.`);
  }
  // Cap warning noise — the first few tell the story.
  const trimmed = warnings.slice(0, 8);
  if (warnings.length > 8) trimmed.push(`…and ${warnings.length - 8} more.`);

  return {
    generated_at: new Date().toISOString(),
    source: "stockton-live",
    player: {
      inventory: Array.from(playerAvail.values()),
      lifetime_orders: Array.from(playerLifetime.values()),
    },
    goalie: {
      inventory: Array.from(goalieAvail.values()),
      lifetime_orders: Array.from(goalieLifetime.values()),
    },
    warnings: trimmed,
  };
}
