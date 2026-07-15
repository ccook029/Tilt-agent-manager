// ---------------------------------------------------------------------------
// org/types.ts — Core types for the Tilt Org OS (Phase 1)
//
// The org model that turns "a flat list of agents" into a real company:
// departments with a boss, employees with reporting lines, and WORK ORDERS —
// the unit of work that flows worker → manager review → owner approval.
//
// Design decisions (Chris, 2026-07-15):
//   - Every department's pipeline runs through its boss, but the OWNER keeps
//     the final approve trigger until he's comfortable graduating a boss.
//   - The Finance team (Penny → Sterling) is the proven prototype of this
//     loop; the engine generalizes it. Finance keeps its bespoke pipeline for
//     now and shares its ledger through org/ledger.ts key mapping.
// ---------------------------------------------------------------------------

export type EmployeeRole = "manager" | "worker";

/**
 * An employee of Tilt Hockey Inc. — an AI staff member with a real position
 * in the org chart. Where a legacy persona/card exists (personas.ts), the
 * employee id matches its agentId so run logs and dashboard cards line up.
 */
export interface Employee {
  id: string;
  name: string;
  title: string;
  departmentId: string;
  role: EmployeeRole;
  /**
   * Who reviews this employee's work. An employee id → that manager reviews
   * every deliverable before it reaches the owner. null → the position
   * reports straight to leadership (Chris/Jeremy), so deliverables go
   * directly to the owner's approval queue.
   */
  reportsTo: string | null;
  /** Matching agentId in personas.ts, when the employee has a legacy card. */
  personaId?: string;
  /** Deliverable types this employee can be assigned (free-form slugs). */
  skills: string[];
  /** One-paragraph job description, injected into the employee's prompts. */
  charter: string;
  /** Model override; defaults to CLAUDE_MODEL (workers) / manager model. */
  model?: string;
  /**
   * false = the position exists in the org chart but its prompts/pipeline
   * aren't built yet (e.g. the Marketing hires staffed in Phase 2). The
   * engine refuses to run work orders for unstaffed positions.
   */
  staffed: boolean;
  enabled: boolean;
}

export interface Department {
  id: string;
  name: string;
  /** The department's charter — what it exists to do. Injected into prompts. */
  mission: string;
  /** Employee id of the boss, or null when members report to leadership. */
  managerId: string | null;
}

// ---- Work orders -----------------------------------------------------------

export type WorkOrderStatus =
  | "queued" // created, not yet run
  | "in_progress" // worker is drafting
  | "in_review" // manager is reviewing the draft
  | "revision" // sent back (by manager or owner) — will re-run with feedback
  | "approved" // boss approved — WAITING ON THE OWNER'S APPROVE TRIGGER
  | "escalated" // blocked on an owner decision (escalation raised)
  | "shipped" // owner approved; deliverable is done/executed
  | "rejected" // owner killed it
  | "error";

/** One worker drafting pass. Round 1 is the original; later rounds carry the
 * feedback that prompted the redo. */
export interface WorkRound {
  round: number;
  draft: string;
  /** Structured decision requests the worker raised (fenced-JSON protocol). */
  decisionRequests: Record<string, unknown>[];
  /** Manager/owner feedback that produced this round (rounds > 1). */
  feedback?: string;
  at: string;
  tokens: { input: number; output: number };
}

export interface ManagerReview {
  round: number;
  verdict: "approve" | "revise" | "escalate";
  /** The review itself — what the boss thought, shown to the owner. */
  notes: string;
  /** Instructions back to the worker when verdict = revise. */
  feedback?: string;
  at: string;
  tokens: { input: number; output: number };
}

/**
 * WorkOrder — the unit of work in the Org OS. Replaces "a run": a brief goes
 * to an employee, the draft goes to their boss, the boss approves / sends it
 * back / escalates, and approved work waits for the owner's trigger to ship.
 */
export interface WorkOrder {
  id: string;
  departmentId: string;
  assigneeId: string;
  title: string;
  brief: string;
  /** e.g. "report", "post-copy", "video-script", "seo-audit". */
  deliverableType: string;
  status: WorkOrderStatus;
  createdBy: string; // "Chris Cook", a manager's employee id, or "cron"
  createdAt: string;
  updatedAt: string;
  rounds: WorkRound[];
  reviews: ManagerReview[];
  /** Escalation ids raised into the department ledger by this work order. */
  escalationIds: string[];
  shippedAt?: string;
  shippedBy?: string;
  /** Owner's notes on ship / send-back / reject. */
  ownerNotes?: string;
  error?: string;
}
