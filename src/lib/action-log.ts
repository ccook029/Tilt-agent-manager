// ---------------------------------------------------------------------------
// action-log.ts — Audit trail for every write the Accounting team makes.
//
// When Penny executes a change in Zoho Books (Wave 1: categorizing bank
// transactions), we record it here with enough before/after detail to review
// and reverse it. This is what makes autonomous execution safe: nothing is a
// black box, and every action is traceable and undoable.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const ACTION_LOG_KEY = "accounting-action-log";
const MAX_ACTIONS = 5000;

export interface AccountingAction {
  id: string;
  timestamp: string;
  /** e.g. "categorize-transaction" */
  type: string;
  /** Whether this actually wrote to Zoho, or was a proposal (dry run). */
  mode: "executed" | "proposed";
  /** The Zoho object touched (transaction id, invoice id, etc.). */
  targetId: string;
  /** Human summary, e.g. "Categorized $340 e-Transfer from J. Martin → Sales (4000)". */
  summary: string;
  /** Structured before/after for reversibility. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Which run produced it. */
  batchId: string;
  /** Set once this write has been undone (feed line returned to Uncategorized). */
  reversed?: boolean;
  reversedAt?: string;
  reversedBy?: string;
}

export async function getActions(): Promise<AccountingAction[]> {
  return (await kv.get<AccountingAction[]>(ACTION_LOG_KEY)) ?? [];
}

export async function logActions(actions: AccountingAction[]): Promise<void> {
  if (actions.length === 0) return;
  const existing = await getActions();
  const merged = [...existing, ...actions].slice(-MAX_ACTIONS);
  await kv.set(ACTION_LOG_KEY, merged);
}

/** Recent actions, newest first. */
export async function getRecentActions(limit = 100): Promise<AccountingAction[]> {
  const all = await getActions();
  return all.slice(-limit).reverse();
}

export async function getActionById(id: string): Promise<AccountingAction | null> {
  return (await getActions()).find((a) => a.id === id) ?? null;
}

/** Mark an action as reversed (after its Zoho write has been undone). */
export async function markActionReversed(
  id: string,
  reversedBy?: string
): Promise<AccountingAction | null> {
  const all = await getActions();
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  all[idx] = {
    ...all[idx],
    reversed: true,
    reversedAt: new Date().toISOString(),
    reversedBy,
  };
  await kv.set(ACTION_LOG_KEY, all);
  return all[idx];
}

export function makeAction(input: {
  type: string;
  mode: "executed" | "proposed";
  targetId: string;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  batchId: string;
  index: number;
}): AccountingAction {
  return {
    id: `act-${input.batchId}-${input.index}`,
    timestamp: new Date().toISOString(),
    type: input.type,
    mode: input.mode,
    targetId: input.targetId,
    summary: input.summary,
    before: input.before,
    after: input.after,
    batchId: input.batchId,
  };
}
