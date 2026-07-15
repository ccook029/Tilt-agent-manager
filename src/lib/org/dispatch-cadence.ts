// ---------------------------------------------------------------------------
// org/dispatch-cadence.ts — "every N days" scheduling for department dispatch
//
// Chris wants marketing on an every-~3-days rhythm once he's comfortable
// (currently he runs it on demand from /review). The daily cron asks this
// module "is it time?"; it tracks the last automatic dispatch in KV so the
// cadence survives deploys and doesn't double-fire. Manual button runs also
// record here, so a hand-run on Monday pushes the next automatic one out.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "org-dispatch-cadence";

interface CadenceState {
  /** departmentId → ISO timestamp of the last dispatch (auto or manual). */
  lastDispatch: Record<string, string>;
}

async function getState(): Promise<CadenceState> {
  const stored = await kv.get<CadenceState>(KEY);
  return { lastDispatch: stored?.lastDispatch ?? {} };
}

/** Record that a department's dispatch ran (called by cron AND manual runs). */
export async function recordDispatch(departmentId: string): Promise<void> {
  const state = await getState();
  state.lastDispatch[departmentId] = new Date().toISOString();
  await kv.set(KEY, state);
}

/**
 * True when at least `everyDays` days have passed since the last dispatch
 * (first run always fires). The cron runs daily, so an interval of 3 fires on
 * roughly every third daily tick.
 */
export async function isDispatchDue(
  departmentId: string,
  everyDays: number
): Promise<boolean> {
  const state = await getState().catch(
    (): CadenceState => ({ lastDispatch: {} })
  );
  const last = state.lastDispatch[departmentId];
  if (!last) return true;
  const elapsed = Date.now() - new Date(last).getTime();
  // A small grace (2h) so a cron that fires a few minutes early still counts.
  return elapsed >= everyDays * 86_400_000 - 2 * 3_600_000;
}
