// ---------------------------------------------------------------------------
// zoho-actions.ts — staged Zoho catalog changes, authored here, pushed by the
// owner from HQ.
//
// The workflow this exists for: work out what needs to happen in conversation,
// commit the batch here, and Chris reviews and pushes it in HQ. Nobody
// transcribes SKUs from screenshots.
//
// A batch says WHICH items by matching rules, never by a hardcoded id list.
// Screenshots are partial and item ids are unreadable from them, so the batch
// is resolved against live Zoho every time it's viewed — what the page shows
// is what the button will act on, current as of that moment.
// ---------------------------------------------------------------------------
import { fetchAllItems, type ZohoItem } from "./zoho";
import { SKU_FILTERS } from "./zoho-sync";

const LIVE_STICK_SKUS = new Set(Object.keys(SKU_FILTERS).map((s) => s.toUpperCase()));

export interface ZohoActionBatch {
  id: string;
  title: string;
  /** Why this batch exists, in the owner's terms. Shown on the card. */
  note: string;
  /** Match on the start of the item name, case-insensitive. Model families
   *  are named consistently ("Canuck-Evolution", "Canuck-Prospect +"), so a
   *  family prefix catches every variant without listing them. */
  namePrefixes: string[];
  action: "zero-and-deactivate";
}

/**
 * Discontinued stick models carrying phantom stock — many of them NEGATIVE,
 * which is how a model that stopped being sold keeps getting shipped on paper.
 * Prefixes come from the Zoho catalog itself; "Beast" is included because
 * Stockton's brief has always listed it as discontinued alongside these.
 *
 * Nothing is retired on the strength of this list alone — the page resolves it
 * against live Zoho and shows every match before anything is pushed.
 */
export const ZOHO_ACTION_BATCHES: ZohoActionBatch[] = [
  {
    id: "discontinued-stick-models",
    title: "Retire discontinued stick models",
    note:
      "Old models we no longer carry, several sitting on negative stock. Zero the counts, then mark each item inactive so it drops out of the catalog. Reversible from Zoho.",
    namePrefixes: [
      "Canuck",
      "Dangler",
      "F22 Raptor",
      "Ghost",
      "Havoc",
      "Ignite",
      "Lithium",
      "Marksman",
      "Phenom",
      "Beast",
    ],
    action: "zero-and-deactivate",
  },
];

export interface MatchedItem {
  itemId: string;
  sku: string;
  name: string;
  stockOnHand: number;
  /** False when Zoho never gave us a number for this item. An unknown count
   *  must never be treated as zero (nothing to do) or as non-zero (adjust by
   *  NaN) — both have already gone wrong once. */
  stockKnown: boolean;
}

/** Zoho omits stock_on_hand on inactive items in the list response, so it
 *  arrives as undefined. Arithmetic on that yields NaN, which serializes into
 *  an adjustment Zoho rejects as "quantity should not be zero". */
function readStock(raw: unknown): { value: number; known: boolean } {
  // null and "" both coerce to 0, which would file a phantom count as
  // "already at zero" and skip it. Absence has to be rejected before the
  // number conversion, not after.
  if (raw === null || raw === undefined || raw === "") {
    return { value: 0, known: false };
  }
  const n = Number(raw);
  return Number.isFinite(n) ? { value: n, known: true } : { value: 0, known: false };
}

export interface ResolvedBatch extends ZohoActionBatch {
  /** Active items the batch will zero and deactivate. */
  matched: MatchedItem[];
  /** Already inactive but still carrying stock. Invisible to an "active only"
   *  filter while their counts keep polluting every report, so they're listed
   *  and their stock still gets zeroed — there's just nothing left to
   *  deactivate. */
  inactiveWithStock: MatchedItem[];
  /** Already inactive and already at zero. Nothing to do; counted so the card
   *  can say "these are done" instead of "nothing matched". */
  alreadyDone: number;
  /** Live stick SKUs the rules would have caught. Reported rather than
   *  silently dropped, because a batch that quietly skips things is how the
   *  wrong thing gets retired next time. */
  protectedFromMatch: string[];
  /** How many items the rules were compared against — the difference between
   *  "no such items" and "couldn't reach the catalog". */
  itemsScanned: number;
  totalUnits: number;
  /** Items whose stock the list endpoint wouldn't report. Their real counts
   *  are fetched per-item before anything is written. */
  stockUnknownCount: number;
}

function matchesPrefixes(item: ZohoItem, prefixes: string[]): boolean {
  const name = (item.name || "").trim().toLowerCase();
  return prefixes.some((p) => name.startsWith(p.trim().toLowerCase()));
}

/** Resolve every batch against the live catalog. Read-only. */
export async function resolveBatches(
  batches: ZohoActionBatch[] = ZOHO_ACTION_BATCHES
): Promise<ResolvedBatch[]> {
  const items = await fetchAllItems();
  return batches.map((batch) => {
    // Match on name across every status first. Filtering by status up front is
    // what made a batch report "nothing matched" when the items were sitting
    // right there, already inactive and still holding negative stock.
    const hits = items.filter((i) => matchesPrefixes(i, batch.namePrefixes));

    const protectedFromMatch: string[] = [];
    const matched: MatchedItem[] = [];
    const inactiveWithStock: MatchedItem[] = [];
    let alreadyDone = 0;

    for (const i of hits) {
      if (i.sku && LIVE_STICK_SKUS.has(i.sku.toUpperCase())) {
        protectedFromMatch.push(i.sku);
        continue;
      }
      const stock = readStock(i.stock_on_hand);
      const entry: MatchedItem = {
        itemId: i.item_id,
        sku: i.sku || "(no SKU)",
        name: i.name,
        stockOnHand: stock.value,
        stockKnown: stock.known,
      };
      if (i.status === "active") matched.push(entry);
      // Unknown counts go in the actionable pile too — they get resolved
      // properly before anything is written, and quietly filing them as
      // "done" would leave real phantom stock behind.
      else if (!stock.known || stock.value !== 0) inactiveWithStock.push(entry);
      else alreadyDone++;
    }

    const byDistance = (a: MatchedItem, b: MatchedItem) =>
      Math.abs(b.stockOnHand) - Math.abs(a.stockOnHand);
    matched.sort(byDistance);
    inactiveWithStock.sort(byDistance);

    return {
      ...batch,
      matched,
      inactiveWithStock,
      alreadyDone,
      protectedFromMatch,
      itemsScanned: items.length,
      totalUnits: [...matched, ...inactiveWithStock].reduce(
        (s, m) => s + (m.stockKnown ? Math.abs(m.stockOnHand) : 0),
        0
      ),
      stockUnknownCount: [...matched, ...inactiveWithStock].filter((m) => !m.stockKnown)
        .length,
    };
  });
}

export async function resolveBatch(id: string): Promise<ResolvedBatch | null> {
  const batch = ZOHO_ACTION_BATCHES.find((b) => b.id === id);
  if (!batch) return null;
  const [resolved] = await resolveBatches([batch]);
  return resolved ?? null;
}
