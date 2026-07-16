// ---------------------------------------------------------------------------
// sales/tiltweb-feed.ts — authed pulls from the tiltweb portal for Sales.
//
// Team orders and retailer/consignment accounts live on tiltweb. Same secured
// pattern the order-builder uses: bearer MODULES_SHARED_KEY, redirects followed
// manually (fetch() strips Authorization on the apex→www hop). Every getter is
// best-effort — a missing endpoint or key degrades to a note, never throws, so
// the Sales department still runs before the tiltweb endpoints are deployed.
// ---------------------------------------------------------------------------
import { TILTWEB_URL } from "@/lib/staff-tools";

/** Follow redirects manually, re-attaching the bearer key each hop. */
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

/** GET a tiltweb module endpoint as JSON, or an { error } note. */
export async function getModule<T>(
  path: string
): Promise<{ data: T } | { error: string }> {
  const key = process.env.MODULES_SHARED_KEY;
  if (!key) return { error: "MODULES_SHARED_KEY is not set on the hub" };
  try {
    const res = await fetchWithKey(`${TILTWEB_URL}${path}`, key);
    if (res.status === 404) {
      return { error: `tiltweb has no ${path} endpoint yet (deploy it there first)` };
    }
    if (!res.ok) throw new Error(`tiltweb returned ${res.status} from ${res.url || path}`);
    return { data: (await res.json()) as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[sales] tiltweb ${path} unreachable:`, msg);
    return { error: msg };
  }
}
