// ---------------------------------------------------------------------------
// org/work-status.ts — "where does this actually sit right now?"
//
// A work order moves worker → boss review → owner queue, and each hop changes
// who is holding it. The status alone doesn't say that: "in_review" means the
// assignee's BOSS has it, "approved" means it's waiting on Chris, "revision"
// means it's back with the assignee. Reading the org chart in your head to
// work that out is exactly what made handoffs invisible.
//
// Pure functions over a work order + the directory, so the board and any
// future briefing can describe a handoff the same way.
// ---------------------------------------------------------------------------
import { getEmployeeById, getManagerOf } from "./directory";
import type { WorkOrder, WorkOrderStatus } from "./types";

/** Live work — the things that are somewhere in the pipe right now. */
export const LIVE_STATUSES: WorkOrderStatus[] = [
  "queued",
  "in_progress",
  "in_review",
  "revision",
  "approved",
  "escalated",
];

export interface Holder {
  /** Who the ball is with: an employee id, "founders", or "nobody". */
  holderId: string;
  /** Display name for that holder. */
  holderName: string;
  /** One line: what is happening, in the founders' language. */
  what: string;
  /** True when the founders are the blocker — these are the actionable ones. */
  needsFounder: boolean;
}

export function whoHolds(order: WorkOrder): Holder {
  const assignee = getEmployeeById(order.assigneeId);
  const assigneeName = assignee?.name ?? order.assigneeId;
  const boss = assignee ? getManagerOf(assignee) : undefined;

  switch (order.status) {
    case "queued":
      return {
        holderId: order.assigneeId,
        holderName: assigneeName,
        what: `Queued for ${assigneeName} — not started yet`,
        needsFounder: false,
      };
    case "in_progress":
      return {
        holderId: order.assigneeId,
        holderName: assigneeName,
        what: `${assigneeName} is drafting it`,
        needsFounder: false,
      };
    case "in_review":
      return {
        holderId: boss?.id ?? order.assigneeId,
        holderName: boss?.name ?? assigneeName,
        what: boss
          ? `${boss.name} is reviewing ${assigneeName}'s draft`
          : `Awaiting review`,
        needsFounder: false,
      };
    case "revision":
      return {
        holderId: order.assigneeId,
        holderName: assigneeName,
        what: boss
          ? `${boss.name} sent it back — ${assigneeName} is redoing it`
          : `Sent back for a redo`,
        needsFounder: false,
      };
    case "approved":
      return {
        holderId: "founders",
        holderName: "Chris & Jeremy",
        what: boss
          ? `${boss.name} approved it — waiting on your ship call`
          : `Approved — waiting on your ship call`,
        needsFounder: true,
      };
    case "escalated":
      return {
        holderId: "founders",
        holderName: "Chris & Jeremy",
        what: `Blocked on a decision only you can make`,
        needsFounder: true,
      };
    case "shipped":
      return {
        holderId: "nobody",
        holderName: "Done",
        what: `Shipped`,
        needsFounder: false,
      };
    case "rejected":
      return {
        holderId: "nobody",
        holderName: "Closed",
        what: `Rejected`,
        needsFounder: false,
      };
    case "error":
      return {
        holderId: "nobody",
        holderName: "Stalled",
        what: order.error
          ? `Errored: ${order.error.slice(0, 160)}`
          : `Errored partway through`,
        needsFounder: true,
      };
  }
}

/** Whole hours since a timestamp — how long the ball has sat where it is. */
export function hoursSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 3_600_000));
}

export function ageLabel(iso: string): string {
  const h = hoursSince(iso);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/**
 * Work that has sat in one place long enough to be worth a second look.
 * Not an SLA — just a nudge so a piece stuck in review for three days shows up
 * as stuck rather than as "in progress" forever.
 */
export function isStalled(order: WorkOrder): boolean {
  return (
    LIVE_STATUSES.includes(order.status) && hoursSince(order.updatedAt) >= 48
  );
}
