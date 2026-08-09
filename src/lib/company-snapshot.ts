// ---------------------------------------------------------------------------
// company-snapshot.ts — the LIVE state of the business, for the Chief of Staff.
//
// Reese used to only see what other agents had already reported. This gives him
// the real thing: finance (Zoho Books), inventory + recent sales orders (Zoho
// Inventory), the cross-HQ signal feed, what every agent is doing, and the
// founders' decision queue — assembled into one block he reads.
//
// The Zoho pulls are slow, so the result is cached in KV. Reads return the
// cached snapshot instantly; when it's stale a refresh runs in the background,
// so Reese is fast and the data stays fresh without a per-message Zoho round
// trip. Only a cold cache builds synchronously (once).
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { fetchBooksSnapshot } from "./zoho-books";
import { fetchInventorySnapshot } from "./zoho";
import { getRecentSignals } from "./signals";
import { getOpenEscalations } from "./policy-ledger";
import { companyActivityItems } from "./activity";

const KEY = "company-snapshot";
const TTL_MS = 25 * 60 * 1000; // refresh in the background after 25 min
const HARD_TTL_MS = 90 * 60 * 1000; // too stale to trust → rebuild synchronously

interface Cached {
  text: string;
  builtAt: string;
}

/** Assemble the live snapshot from every source (slow — hits Zoho). */
export async function buildCompanySnapshotText(): Promise<string> {
  const [books, inventory, signals, escalations, activity] = await Promise.all([
    fetchBooksSnapshot().catch(() => "(finance snapshot unavailable)"),
    fetchInventorySnapshot().catch(() => "(inventory snapshot unavailable)"),
    getRecentSignals().catch(() => [] as { source: string; headline: string; detail?: string }[]),
    getOpenEscalations().catch(() => [] as { question: string }[]),
    companyActivityItems().catch(() => [] as { agentName: string; title: string; status: string }[]),
  ]);

  const sig =
    signals
      .slice(0, 12)
      .map((s) => `- [${s.source}] ${s.headline}${s.detail ? ` — ${s.detail}` : ""}`)
      .join("\n") || "(no recent signals)";
  const dec =
    escalations.length > 0
      ? escalations.slice(0, 8).map((e) => `- ${e.question}`).join("\n")
      : "(none)";
  const act =
    activity
      .slice(0, 15)
      .map((i) => `- ${i.agentName}: ${i.title} [${i.status}]`)
      .join("\n") || "(quiet right now)";

  return [
    "# LIVE COMPANY SNAPSHOT — the real state of Tilt right now",
    "You have this data directly; use the actual numbers, don't hedge that you can't see the systems.",
    "",
    "## Finance (Zoho Books — cash flow, A/R, A/P, uncategorized)",
    books.slice(0, 3500),
    "",
    "## Inventory & Sales (Zoho Inventory — stock, recent sales orders, purchase orders)",
    inventory.slice(0, 3500),
    "",
    "## Recent activity across HQ (signals, last ~day)",
    sig,
    "",
    "## What every agent is working on / has done",
    act,
    "",
    "## Decisions waiting on the founders",
    dec,
  ].join("\n");
}

async function readCache(): Promise<Cached | null> {
  try {
    return (await kv.get<Cached>(KEY)) ?? null;
  } catch {
    return null;
  }
}

/** Build + cache the snapshot. Called on a cold cache and on stale refresh. */
export async function refreshCompanySnapshot(): Promise<Cached> {
  const text = await buildCompanySnapshotText();
  const entry: Cached = { text, builtAt: new Date().toISOString() };
  try {
    await kv.set(KEY, entry);
  } catch {
    /* cache write is best-effort */
  }
  return entry;
}

/**
 * The snapshot for Reese's context. Returns the cached copy instantly; if it's
 * stale, kicks a background refresh (not awaited) so the NEXT read is fresh. A
 * cold cache builds synchronously (once).
 */
export async function getCompanySnapshot(): Promise<string> {
  const cached = await readCache();
  const age = cached ? Date.now() - new Date(cached.builtAt).getTime() : Infinity;

  // Cold cache, or so stale we can't trust it (a background refresh may have
  // been killed mid-flight in serverless) → rebuild now.
  if (!cached || age > HARD_TTL_MS) {
    const fresh = await refreshCompanySnapshot();
    return `${fresh.text}\n\n(snapshot as of ${fresh.builtAt})`;
  }
  // Stale-but-usable → return it now, refresh in the background for next time.
  if (age > TTL_MS) void refreshCompanySnapshot();
  return `${cached.text}\n\n(snapshot as of ${cached.builtAt}${age > TTL_MS ? " — refreshing" : ""})`;
}
