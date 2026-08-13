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
}

export interface ResolvedBatch extends ZohoActionBatch {
  matched: MatchedItem[];
  /** Live stick SKUs the rules would have caught. Always empty in practice —
   *  reported rather than silently dropped, because a batch that quietly
   *  skipped something is how the wrong thing gets retired next time. */
  protectedFromMatch: string[];
  totalUnits: number;
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
    const hits = items.filter(
      (i) => i.status === "active" && matchesPrefixes(i, batch.namePrefixes)
    );
    const protectedFromMatch: string[] = [];
    const matched: MatchedItem[] = [];
    for (const i of hits) {
      if (i.sku && LIVE_STICK_SKUS.has(i.sku.toUpperCase())) {
        protectedFromMatch.push(i.sku);
        continue;
      }
      matched.push({
        itemId: i.item_id,
        sku: i.sku || "(no SKU)",
        name: i.name,
        stockOnHand: i.stock_on_hand,
      });
    }
    matched.sort((a, b) => Math.abs(b.stockOnHand) - Math.abs(a.stockOnHand));
    return {
      ...batch,
      matched,
      protectedFromMatch,
      totalUnits: matched.reduce((s, m) => s + Math.abs(m.stockOnHand), 0),
    };
  });
}

export async function resolveBatch(id: string): Promise<ResolvedBatch | null> {
  const batch = ZOHO_ACTION_BATCHES.find((b) => b.id === id);
  if (!batch) return null;
  const [resolved] = await resolveBatches([batch]);
  return resolved ?? null;
}
