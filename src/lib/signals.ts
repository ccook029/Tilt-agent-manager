// ---------------------------------------------------------------------------
// signals.ts — Cross-tool event inbox (Vercel KV)
//
// The integration primitive for Tilt OS: any Tilt tool (Social Studio, Web
// Admin, Catalog Agent, or an internal pipeline) pushes one-line headlines
// here, and they flow into the Morning Brief and the dashboard. Satellites
// integrate with a single POST — no shared code needed.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "tilt-signals";
const MAX_SIGNALS = 300;

export interface Signal {
  at: string; // ISO timestamp
  /** Which tool/agent sent it, e.g. "social-studio", "web-admin", "inventory". */
  source: string;
  /** One-line headline, e.g. "3 posts scheduled for next week". */
  headline: string;
  detail?: string;
}

export async function postSignal(s: Omit<Signal, "at">): Promise<void> {
  const list = (await kv.get<Signal[]>(KEY)) ?? [];
  await kv.set(
    KEY,
    [...list, { ...s, at: new Date().toISOString() }].slice(-MAX_SIGNALS)
  );
}

/** Signals from the last `hours` (newest first). */
export async function getRecentSignals(hours = 26): Promise<Signal[]> {
  const list = (await kv.get<Signal[]>(KEY)) ?? [];
  const since = Date.now() - hours * 3600_000;
  return list.filter((s) => new Date(s.at).getTime() >= since).reverse();
}
