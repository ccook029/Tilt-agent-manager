// ---------------------------------------------------------------------------
// custom-queue.ts — the pending custom-stick queue from the tiltweb admin.
//
// This queue is the factory feed: every custom stick ordered anywhere (store
// checkout, the custom-order form, retailer portal, team orders, ambassador
// kits, manual admin entry) lands in tiltweb's `custom_orders` table, and the
// admin portal drives it to the factory. The old Zoho "Custom Player/Goalie
// Sticks" tabs are retired — the Zoho sheet is the inventory of actual on-hand
// sticks and nothing else.
//
// Both consumers of committed custom demand read from here: the Stick Order
// Builder (order-builder/data.ts) and Stockton's biweekly factory reorder
// (factory-reorder.ts).
// ---------------------------------------------------------------------------
import { TILTWEB_URL } from "@/lib/staff-tools";

/**
 * A pending custom order from the tiltweb admin queue
 * (GET {tiltweb}/api/modules/custom-orders — status new/downloaded only).
 */
export interface AdminCustomOrder {
  kind: "player" | "goalie";
  player_name: string | null;
  player_number: string | null;
  team: string | null;
  specs: Record<string, unknown>;
}

/**
 * Fetch with the bearer key preserved across redirects. fetch() strips the
 * Authorization header on cross-origin redirects (e.g. tilthockey.com →
 * www.tilthockey.com), which turns a valid call into a silent 401 — so we
 * follow redirects manually and re-attach the key each hop.
 */
export async function fetchWithKey(
  url: string,
  key: string,
  hops = 0
): Promise<Response> {
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

/**
 * Fetch the PENDING custom-order queue (the exact list shown in
 * /admin/custom-orders that hasn't been marked 'ordered').
 *
 * Returns an error rather than throwing: callers decide whether missing
 * custom demand is worth blocking on, and every caller should say out loud
 * that the customs are missing rather than quietly reporting zero.
 */
export async function fetchAdminCustomQueue(): Promise<
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
    console.warn("[custom-queue] admin custom queue unreachable:", msg);
    return { error: msg };
  }
}
