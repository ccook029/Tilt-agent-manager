// ---------------------------------------------------------------------------
// activity.ts — one normalized "what's happening" model across the company.
//
// Folds three existing signals into a single ActivityItem stream so the same UI
// can show one agent's work OR the whole company's:
//   • run logs        — finished scheduled/dispatched runs (every agent)
//   • work orders      — the org engine's live status (queued → in_progress →
//                        in_review → approved/escalated → shipped)
//   • pending tasks    — accounting's in-flight background dispatch (Penny)
// `active` marks the items still in flight or needing the owner, so the UI can
// split "working now / needs you" from "done".
// ---------------------------------------------------------------------------
import { getRunLogs, getRunLogsByAgent } from "./store";
import { listWorkOrders } from "./org/work-orders";
import { getPendingTasks } from "./accounting-activity";
import { getEmployeeById } from "./org/directory";
import { getAgentById } from "./agent-registry";
import type { WorkOrder } from "./org/types";

export interface ActivityItem {
  id: string;
  kind: "run" | "work" | "pending";
  agentId: string;
  agentName: string;
  title: string;
  status: string;
  at: string; // ISO
  body: string; // report / draft (may be empty)
  active: boolean; // in flight or waiting on the owner
}

// Work-order statuses that are NOT finished — still moving or needing you.
const ACTIVE_WO = new Set([
  "queued",
  "in_progress",
  "in_review",
  "revision",
  "approved", // approved by the boss, waiting on the owner's ship trigger
  "escalated", // blocked on an owner decision
]);

const TASK_LABELS: Record<string, string> = {
  "auto-categorize": "Categorizing transactions",
  "books-health": "Running the books-health report",
  reconcile: "Reconciling accounts",
};
function taskLabel(task: string): string {
  return TASK_LABELS[task] ?? task.replace(/[-_]/g, " ");
}

function nameOf(agentId: string): string {
  return getEmployeeById(agentId)?.name ?? getAgentById(agentId)?.name ?? agentId;
}

function woItem(wo: WorkOrder): ActivityItem {
  const draft = wo.rounds[wo.rounds.length - 1]?.draft ?? "";
  return {
    id: wo.id,
    kind: "work",
    agentId: wo.assigneeId,
    agentName: nameOf(wo.assigneeId),
    title: wo.title,
    status: wo.status,
    at: wo.updatedAt,
    body: draft,
    active: ACTIVE_WO.has(wo.status),
  };
}

function runItem(l: {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  output: string;
}): ActivityItem {
  return {
    id: l.id,
    kind: "run",
    agentId: l.agentId,
    agentName: nameOf(l.agentId),
    title: l.agentName, // the descriptive run label (often includes the task)
    status: l.status,
    at: l.finishedAt || l.startedAt,
    body: l.output,
    active: false,
  };
}

function pendingItems(pending: { id: string; task: string; startedAt: string }[]): ActivityItem[] {
  return pending.map((p) => ({
    id: p.id,
    kind: "pending" as const,
    agentId: "accounting",
    agentName: "Penny Quill",
    title: taskLabel(p.task),
    status: "working",
    at: p.startedAt,
    body: "",
    active: true,
  }));
}

function byNewest(a: ActivityItem, b: ActivityItem): number {
  return (b.at || "").localeCompare(a.at || "");
}

/** Accounting agents carry financial detail — kept out of non-owner views. */
export const ACCOUNTING_AGENT_IDS = new Set(["accounting", "accounting-manager"]);

/** One agent's activity: their runs + work orders (+ pending, for accounting). */
export async function agentActivityItems(agentId: string): Promise<ActivityItem[]> {
  const [runs, wos, pending] = await Promise.all([
    getRunLogsByAgent(agentId).catch(() => []),
    listWorkOrders({ assigneeId: agentId, limit: 20 }).catch(() => []),
    agentId === "accounting" ? getPendingTasks().catch(() => []) : Promise.resolve([]),
  ]);
  return [...pendingItems(pending), ...wos.map(woItem), ...runs.map(runItem)]
    .sort(byNewest)
    .slice(0, 40);
}

/** The whole company's recent activity, newest first. `includeAccounting`
 *  gates the finance agents' items to the accounting owner. */
export async function companyActivityItems(includeAccounting = false): Promise<ActivityItem[]> {
  const [runs, wos, pending] = await Promise.all([
    getRunLogs().catch(() => []),
    listWorkOrders({ limit: 80 }).catch(() => []),
    includeAccounting ? getPendingTasks().catch(() => []) : Promise.resolve([]),
  ]);
  const items = [...pendingItems(pending), ...wos.map(woItem), ...runs.map(runItem)].filter(
    (i) => includeAccounting || !ACCOUNTING_AGENT_IDS.has(i.agentId)
  );
  return items.sort(byNewest).slice(0, 60);
}
