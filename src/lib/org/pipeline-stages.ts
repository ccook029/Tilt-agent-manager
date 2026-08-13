// ---------------------------------------------------------------------------
// pipeline-stages.ts — the nine work-order statuses, collapsed into the four
// stages a founder actually tracks.
//
// The statuses are right for the engine and wrong for a person watching. It
// isn't obvious that "approved" means waiting on YOU rather than finished, or
// that "revision" and "queued" are both just "not started yet". Worse, they
// were split across two pages with different buttons, so there was no single
// place to watch something move.
//
// One ordered list, so a card visibly travels left to right.
// ---------------------------------------------------------------------------
import type { WorkOrderStatus } from "./types";

export type Stage = "queued" | "working" | "review" | "you" | "done";

export const STAGE_ORDER: Stage[] = ["queued", "working", "review", "you", "done"];

export const STAGE_LABELS: Record<Stage, string> = {
  queued: "Not started",
  working: "Being worked on",
  review: "With their manager",
  you: "Waiting on you",
  done: "Done",
};

export const STAGE_BLURBS: Record<Stage, string> = {
  queued: "Assigned but not picked up yet",
  working: "An agent is drafting it now",
  review: "Their manager is checking the draft",
  you: "Nothing moves until you decide",
  done: "Shipped, or closed out",
};

export function stageOf(status: WorkOrderStatus): Stage {
  switch (status) {
    case "queued":
    case "revision":
      return "queued";
    case "in_progress":
      return "working";
    case "in_review":
      return "review";
    case "approved":
    case "escalated":
      return "you";
    case "shipped":
    case "rejected":
      return "done";
    case "error":
      // An error needs a person, so it belongs where a person is looking.
      return "you";
  }
}

/** Plain-language status, for the card. The engine's word is rarely the
 *  useful one — "approved" reads as finished when it means the opposite. */
export const STATUS_PHRASING: Record<WorkOrderStatus, string> = {
  queued: "Queued",
  in_progress: "Drafting",
  in_review: "Manager reviewing",
  revision: "Sent back for changes",
  approved: "Approved by their manager — needs your go-ahead",
  escalated: "Blocked on a decision from you",
  shipped: "Shipped",
  rejected: "Killed",
  error: "Hit an error",
};
