// ---------------------------------------------------------------------------
// accounting-activity.ts — "what is Penny doing right now" (Vercel KV).
//
// Dispatched tasks run in the background and only write a run-log when they
// FINISH, so there's a blind window between "Sterling put Penny on it" and the
// result landing. This tracks the in-flight tasks so the activity panel can
// show "Working on…" live. Best-effort; stale entries (a crashed run that never
// cleared) are pruned on read so nothing hangs forever.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "accounting-pending-tasks";
const STALE_MS = 15 * 60 * 1000; // a task in flight longer than this is presumed dead

export interface PendingTask {
  id: string;
  task: string;
  startedAt: string; // ISO
}

export async function addPendingTask(task: string): Promise<string> {
  const id = `${task}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    const list = (await kv.get<PendingTask[]>(KEY)) ?? [];
    list.push({ id, task, startedAt: new Date().toISOString() });
    await kv.set(KEY, list);
  } catch {
    /* tracking must never break the actual work */
  }
  return id;
}

export async function removePendingTask(id: string): Promise<void> {
  try {
    const list = (await kv.get<PendingTask[]>(KEY)) ?? [];
    await kv.set(
      KEY,
      list.filter((t) => t.id !== id)
    );
  } catch {
    /* ignore */
  }
}

export async function getPendingTasks(): Promise<PendingTask[]> {
  try {
    const list = (await kv.get<PendingTask[]>(KEY)) ?? [];
    const now = Date.now();
    const fresh = list.filter((t) => now - new Date(t.startedAt).getTime() < STALE_MS);
    if (fresh.length !== list.length) await kv.set(KEY, fresh); // prune dead entries
    return fresh;
  } catch {
    return [];
  }
}
