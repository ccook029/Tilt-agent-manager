// ---------------------------------------------------------------------------
// books-snapshot.ts — the live Zoho Books position, cached.
//
// fetchBooksSnapshot() hits Zoho (slow), so cache it: reads return instantly, a
// background refresh runs when stale (>25 min), and a hard cap (>90 min / cold
// cache) forces a synchronous rebuild so it can't serve indefinitely-stale data
// if a background refresh gets killed in serverless. Shared by Sterling/Penny's
// chat and Reese's company snapshot, so the Zoho pull happens once.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { fetchBooksSnapshot } from "./zoho-books";

const KEY = "books-snapshot";
const TTL_MS = 25 * 60 * 1000;
const HARD_TTL_MS = 90 * 60 * 1000;

interface Cached {
  text: string;
  builtAt: string;
}

export async function refreshBooksSnapshot(): Promise<Cached> {
  const text = await fetchBooksSnapshot();
  const entry: Cached = { text, builtAt: new Date().toISOString() };
  try {
    await kv.set(KEY, entry);
  } catch {
    /* best-effort cache */
  }
  return entry;
}

export async function getCachedBooksSnapshot(): Promise<string> {
  let cached: Cached | null = null;
  try {
    cached = (await kv.get<Cached>(KEY)) ?? null;
  } catch {
    cached = null;
  }
  const age = cached ? Date.now() - new Date(cached.builtAt).getTime() : Infinity;
  if (!cached || age > HARD_TTL_MS) {
    return (await refreshBooksSnapshot()).text;
  }
  if (age > TTL_MS) void refreshBooksSnapshot();
  return cached.text;
}
