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
import { TILTWEB_URL } from "@/lib/staff-tools";
import type { ComboRow, GoalieComboRow, OrderDataset } from "./allocator";

/**
 * A pending custom order from the tiltweb admin queue
 * (GET {tiltweb}/api/modules/custom-orders — status new/downloaded only).
 */
interface AdminCustomOrder {
  kind: "player" | "goalie";
  player_name: string | null;
  player_number: string | null;
  team: string | null;
  specs: Record<string, unknown>;
}

/**
 * Fetch the PENDING custom-order queue from the tiltweb admin (the exact list
 * shown in /admin/custom-orders that hasn't been marked 'ordered'). This — not
 * the Zoho custom tabs, which hold all-time history — is what rides the PO.
 */
/**
 * Fetch with the bearer key preserved across redirects. fetch() strips the
 * Authorization header on cross-origin redirects (e.g. tilthockey.com →
 * www.tilthockey.com), which turns a valid call into a silent 401 — so we
 * follow redirects manually and re-attach the key each hop.
 */
async function fetchWithKey(url: string, key: string, hops = 0): Promise<Response> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}` },
    cache: "no-store",
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400 && hops < 4) {
    const loc = res.headers.get("location");
    if (loc) return fetchWithKey(new URL(loc, url).toString(), key, hops + 1);
  }
  return res;
}

async function fetchAdminCustomQueue(): Promise<
  { orders: AdminCustomOrder[] } | { error: string }
> {
  const key = process.env.MODULES_SHARED_KEY;
  if (!key) return { error: "MODULES_SHARED_KEY is not set on the hub" };
  try {
    const res = await fetchWithKey(`${TILTWEB_URL}/api/modules/custom-orders`, key);
    if (!res.ok) throw new Error(`tiltweb returned ${res.status} from ${res.url || TILTWEB_URL}`);
    const j = (await res.json()) as { ok?: boolean; orders?: AdminCustomOrder[] };
    if (!j.ok || !Array.isArray(j.orders)) throw new Error("bad payload from tiltweb");
    return { orders: j.orders };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[order-builder] admin custom queue unreachable:", msg);
    return { error: msg };
  }
}

/** Pull the leading number out of spec strings like '56"' or '24" paddle'. */
function specNum(v: unknown): number {
  const m = String(v ?? "").match(/\d+/);
  return m ? Number(m[0]) : 0;
}

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
  const [records, adminQueue] = await Promise.all([
    fetchAllStickRecords(),
    // Committed custom orders come from the tiltweb ADMIN QUEUE (the pending
    // list in /admin/custom-orders) — not the Zoho custom tabs, which hold
    // all-time history. Best-effort: unreachable → warn, don't block.
    fetchAdminCustomQueue(),
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

  // ── Committed custom orders — the tiltweb admin's PENDING queue ──
  if ("error" in adminQueue) {
    warnings.push(
      `Custom-order queue unreachable (${adminQueue.error}) — committed customs are NOT included in this run.`
    );
  } else {
    for (const o of adminQueue.orders) {
      const s = o.specs || {};
      const str = (k: string) => String(s[k] ?? "").trim();
      if (o.kind === "goalie") {
        const paddle = specNum(s.paddle ?? s.size);
        if (!paddle) {
          warnings.push(`Skipped queued goalie order for ${o.player_name ?? "?"} — no paddle size.`);
          continue;
        }
        addGoalie(
          customGoalie,
          paddle,
          normHand(str("hand")) ?? "Left",
          normColor(str("baseColor")),
          normColor(str("decalColor") || str("graphic"))
        );
        continue;
      }
      const size = specNum(s.size);
      const level = normLevel(str("level"), size);
      if (!level || !size) {
        warnings.push(
          `Skipped queued custom order for ${o.player_name ?? o.team ?? "?"} — level "${str("level")}", size "${str("size")}".`
        );
        continue;
      }
      const { flex } = snapFlex(specNum(s.flex));
      add(customPlayer, {
        level,
        size,
        carbon: (str("carbon") || (str("model").includes("24K") ? "24K" : "18K")).toUpperCase(),
        kick: normKick(str("kickPoint") || str("kick")),
        hand: normHand(str("hand")) ?? "Left",
        flex,
        curve: str("curve").toUpperCase(),
        baseColor: normColor(str("baseColor")),
        decalColor: normColor(str("decalColor") || str("graphic")),
      });
    }
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
