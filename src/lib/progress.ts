// ---------------------------------------------------------------------------
// progress.ts — Cleanup progress over time (Vercel KV)
//
// One point per categorization batch: how big the uncategorized backlog is and
// how many writes happened. Powers the dashboard "burning down" tile and the
// Morning Brief trend line.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "accounting-progress";
const MAX_POINTS = 180;

export interface ProgressPoint {
  /** ISO timestamp of the batch. */
  at: string;
  /** Uncategorized transactions remaining after the batch. */
  uncategorized: number;
  /** Writes executed in the batch. */
  written: number;
}

export async function recordProgress(p: ProgressPoint): Promise<void> {
  const list = (await kv.get<ProgressPoint[]>(KEY)) ?? [];
  await kv.set(KEY, [...list, p].slice(-MAX_POINTS));
}

export async function getProgress(): Promise<ProgressPoint[]> {
  return (await kv.get<ProgressPoint[]>(KEY)) ?? [];
}
