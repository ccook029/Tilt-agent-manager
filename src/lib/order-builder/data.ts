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
import {
  fetchAllStickRecords,
  fetchCustomStickRecords,
  type StickRecord,
} from "@/lib/zoho-sheet";
import type { ComboRow, GoalieComboRow, OrderDataset } from "./allocator";

function normLevel(raw: string, size: number): "Junior" | "Intermediate" | "Senior" | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith("jr") || t.startsWith("jun")) return "Junior";
  if (t.startsWith("int")) return "Intermediate";
  if (t.startsWith("sr") || t.startsWith("sen")) return "Senior";
  // "Tier 1" is Tilt's junior model line — the sheet records the model name in
  // the Level column for those sticks.
  if (t.includes("tier")) return "Junior";
  // Last resort: a model name we don't know — infer the level from the length
  // so a new sheet value degrades demand slightly instead of dropping rows.
  if (size > 0) {
    if (size <= 57) return "Junior";
    if (size <= 63) return "Intermediate";
    return "Senior";
  }
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
  return [r.level, r.size, r.carbon, r.kick, r.hand, r.flex, r.curve, r.baseColor, r.decalColor].join("|");
}

/** Tidy a human-entered color: trim, collapse spaces, Title Case. */
function normColor(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(" ");
}

export async function buildOrderDataset(): Promise<OrderDataset> {
  const [records, customRecords] = await Promise.all([
    fetchAllStickRecords(),
    // Committed custom orders — best-effort: a broken custom tab shouldn't
    // take the whole builder down, just surface a warning.
    fetchCustomStickRecords().catch((err) => {
      console.warn("[order-builder] custom tabs unreadable:", err);
      return [] as StickRecord[];
    }),
  ]);
  const warnings: string[] = [];
  let snappedCount = 0;

  const playerLifetime = new Map<string, ComboRow>();
  const playerAvail = new Map<string, ComboRow>();
  const goalieLifetime = new Map<string, GoalieComboRow>();
  const goalieAvail = new Map<string, GoalieComboRow>();
  const customPlayer = new Map<string, ComboRow>();
  const customGoalie = new Map<string, GoalieComboRow>();

  const add = (map: Map<string, ComboRow>, row: Omit<ComboRow, "qty">) => {
    const k = comboKey(row);
    const cur = map.get(k);
    if (cur) cur.qty += 1;
    else map.set(k, { ...row, qty: 1 });
  };
  const addGoalie = (
    map: Map<string, GoalieComboRow>,
    paddle: number,
    hand: string,
    baseColor: string,
    decalColor: string
  ) => {
    const k = `${paddle}|${hand}|${baseColor}|${decalColor}`;
    const cur = map.get(k);
    if (cur) cur.qty += 1;
    else map.set(k, { paddle, hand, baseColor, decalColor, qty: 1 });
  };

  for (const r of records as StickRecord[]) {
    const isGoalie = r.tab.toLowerCase().includes("goalie");
    const available = r.status.trim().toLowerCase() === "available";

    if (isGoalie) {
      const paddle = Math.round(r.size);
      const hand = normHand(r.hand) ?? "Left";
      if (!paddle) continue;
      const gBase = normColor(r.base_color);
      const gDecal = normColor(r.decal_color);
      addGoalie(goalieLifetime, paddle, hand, gBase, gDecal);
      if (available) addGoalie(goalieAvail, paddle, hand, gBase, gDecal);
      continue;
    }

    const level = normLevel(r.level, r.size);
    const hand = normHand(r.hand);
    if (!level || !r.size || !r.flex) {
      const why = !level
        ? `unrecognized level "${r.level}" with no usable length`
        : !r.size
          ? "missing size"
          : "missing flex";
      warnings.push(`Skipped Player row ${r.row_index} — ${why}.`);
      continue;
    }
    if (!r.level.trim().toLowerCase().match(/^(jr|jun|int|sr|sen|tier)/)) {
      warnings.push(
        `Row ${r.row_index}: level "${r.level}" inferred as ${level} from its ${r.size}" length.`
      );
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
      baseColor: normColor(r.base_color),
      decalColor: normColor(r.decal_color),
    };
    add(playerLifetime, row);
    if (available) add(playerAvail, row);
  }

  // ── Committed custom orders (admin panel queue → Zoho custom tabs) ──
  for (const r of customRecords as StickRecord[]) {
    const isGoalie = r.tab.toLowerCase().includes("goalie");
    if (isGoalie) {
      const paddle = Math.round(r.size);
      if (!paddle) continue;
      addGoalie(customGoalie, paddle, normHand(r.hand) ?? "Left", normColor(r.base_color), normColor(r.decal_color));
      continue;
    }
    const level = normLevel(r.level, r.size);
    if (!level || !r.size) {
      warnings.push(`Skipped custom row ${r.row_index} (level="${r.level}", size=${r.size}) — couldn't normalize.`);
      continue;
    }
    const { flex } = snapFlex(r.flex || 0);
    add(customPlayer, {
      level,
      size: Math.round(r.size),
      carbon: r.carbon.trim().toUpperCase() || "18K",
      kick: normKick(r.kick_point),
      hand: normHand(r.hand) ?? "Left",
      flex,
      curve: r.curve.trim().toUpperCase(),
      baseColor: normColor(r.base_color),
      decalColor: normColor(r.decal_color),
    });
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
    custom: {
      player: Array.from(customPlayer.values()),
      goalie: Array.from(customGoalie.values()),
    },
    warnings: trimmed,
  };
}
