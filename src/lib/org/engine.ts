// ---------------------------------------------------------------------------
// org/engine.ts — The department engine: worker → boss review → owner gate
//
// The generalization of the accounting team's proven loop (accounting-loop.ts)
// to any department:
//
//   1. WORKER drafts the deliverable for a work order (propose-only), raising
//      structured decision requests for anything they can't decide.
//   2. Their BOSS reviews it against the department's mission, the company
//      knowledge, and the learned policy ledger — approve / send back with
//      feedback (bounded rounds) / escalate to the owner.
//   3. Boss-approved work STOPS at "approved": the owner keeps the final
//      ship trigger (Chris's call, 2026-07-15) until a boss is graduated.
//      Escalations land in the department ledger; answers become policy.
//
// Positions with reportsTo: null skip step 2 — their work goes straight to
// the owner's queue, same as today's solo agents, but now as reviewable
// work orders instead of fire-and-forget emails.
// ---------------------------------------------------------------------------
import { callClaude } from "../anthropic";
import { CLAUDE_MODEL, CLAUDE_MANAGER_MODEL } from "../models";
import { renderOrgKnowledge } from "../org-knowledge";
import { renderCrossAgentSignals } from "../cross-agent";
import { postSignal } from "../signals";
import { saveRunLogs } from "../store";
import {
  getDepartmentById,
  getEmployeeById,
  getManagerOf,
} from "./directory";
import {
  addEscalations,
  renderPolicyBlock,
} from "./ledger";
import {
  getWorkOrder,
  updateWorkOrder,
} from "./work-orders";
import {
  buildDefaultSystemPrompt,
  getEmployeeProfile,
} from "./employee-configs";
import { renderDepartmentContext } from "./department-context";
import { executeShip } from "./ship-executors";
import type {
  Department,
  Employee,
  ManagerReview,
  WorkOrder,
  WorkRound,
} from "./types";

/** Total worker drafting passes (1 original + up to 2 revisions). */
const MAX_WORKER_ROUNDS = 3;

// ---- Fenced-JSON parsing (same protocol the accounting team uses) ----------

function lastJsonBlock(text: string): string | null {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null;
}

function parseJsonArray(text: string): Record<string, unknown>[] {
  const block = lastJsonBlock(text);
  if (!block) return [];
  try {
    const parsed = JSON.parse(block);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseReviewBlock(text: string): {
  verdict: "approve" | "revise" | "escalate";
  feedback?: string;
  escalations: Array<{
    question: string;
    reason: string;
    recommendation?: string;
    dollarAmount?: number;
  }>;
} {
  const fallback = { verdict: "escalate" as const, escalations: [] };
  const block = lastJsonBlock(text);
  if (!block) return fallback;
  try {
    const parsed = JSON.parse(block) as Record<string, unknown>;
    const verdict =
      parsed.verdict === "approve" ||
      parsed.verdict === "revise" ||
      parsed.verdict === "escalate"
        ? parsed.verdict
        : "escalate";
    const escalations = Array.isArray(parsed.escalations)
      ? parsed.escalations
          .map((e) => {
            const item = e as Record<string, unknown>;
            return {
              question: String(item.question ?? "").trim(),
              reason: String(item.reason ?? "raised by the department manager"),
              recommendation: item.recommendation
                ? String(item.recommendation)
                : undefined,
              dollarAmount:
                typeof item.dollar_amount === "number"
                  ? item.dollar_amount
                  : undefined,
            };
          })
          .filter((e) => e.question.length > 0)
      : [];
    return {
      verdict,
      feedback:
        typeof parsed.feedback === "string" && parsed.feedback.trim()
          ? parsed.feedback.trim()
          : undefined,
      escalations,
    };
  } catch {
    return fallback;
  }
}

/** Strip the machine-read json block so humans see clean prose. */
function stripJsonBlock(text: string): string {
  const matches = [...text.matchAll(/```json\s*[\s\S]*?```/gi)];
  if (matches.length === 0) return text.trim();
  const last = matches[matches.length - 1][0];
  return text.replace(last, "").trim();
}

// ---- Prompt assembly ---------------------------------------------------------

async function buildWorkerSystemPrompt(
  employee: Employee,
  department: Department
): Promise<string> {
  const profile = getEmployeeProfile(employee.id);
  const base =
    profile?.systemPrompt ?? buildDefaultSystemPrompt(employee, department);
  const knowledge = await renderOrgKnowledge().catch(() => "");
  const signals = await renderCrossAgentSignals(employee.id).catch(() => "");
  const deptContext = await renderDepartmentContext(employee).catch(() => "");
  return base + knowledge + signals + deptContext;
}

function buildWorkerUserMessage(
  order: WorkOrder,
  policyBlock: string,
  guidance?: string
): string {
  const parts: string[] = [
    `# WORK ORDER: ${order.title}`,
    `Deliverable type: ${order.deliverableType}`,
    `Requested by: ${order.createdBy}`,
    "",
    "## Brief",
    order.brief,
    "",
    policyBlock,
  ];

  if (guidance) {
    parts.push("", "## What a good deliverable looks like", guidance);
  }

  const lastRound = order.rounds[order.rounds.length - 1];
  if (lastRound) {
    parts.push(
      "",
      "## Your previous draft (round " + lastRound.round + ")",
      lastRound.draft.slice(0, 8000)
    );
  }
  const lastReview = order.reviews[order.reviews.length - 1];
  if (lastReview?.feedback) {
    parts.push(
      "",
      "## REQUIRED CHANGES from your boss's review — address every point",
      lastReview.feedback
    );
  }
  // Present until a verdict clears them, so a send-back's notes reach the
  // worker even though the status has already moved to in_progress.
  if (order.ownerNotes) {
    parts.push(
      "",
      "## Notes from Chris (the owner) on the last version",
      order.ownerNotes
    );
  }

  parts.push(
    "",
    lastRound
      ? "Produce the REVISED deliverable in full (not a diff), then your decision requests json block if any."
      : "Produce the deliverable now, then your decision requests json block if any."
  );
  return parts.join("\n");
}

async function buildManagerSystemPrompt(
  manager: Employee,
  department: Department
): Promise<string> {
  const profile = getEmployeeProfile(manager.id);
  const base =
    profile?.managerSystemPrompt ??
    `You are ${manager.name}, ${manager.title} at Tilt Hockey Inc., the boss of the ${department.name} department.

DEPARTMENT MISSION: ${department.mission}

YOUR ROLE IN THIS REVIEW: a member of your team has submitted a deliverable for a work order. You are the quality gate between your team and the founders.
- Hold a high bar: is it correct, complete, on-brand, specific to Tilt, and actually what the brief asked for? Mediocre work does NOT pass.
- Resolve the worker's decision requests yourself wherever established policy or your professional judgment covers them.
- Escalate to Chris Cook (the owner) ONLY what genuinely needs him: real judgment calls, material spending, precedent-setting choices, or anything public-facing you're not confident about. Always include your recommendation so he can just say yes.
- The owner currently keeps the final approve trigger on ALL shipped work — your approval sends it to his queue, it does not publish anything. So approve when the work meets YOUR bar; don't escalate just to be safe.

TONE: direct, specific, brief. Reference exact parts of the deliverable.`;
  const knowledge = await renderOrgKnowledge().catch(() => "");
  const deptContext = await renderDepartmentContext(manager).catch(() => "");
  return base + knowledge + deptContext;
}

function buildManagerUserMessage(
  order: WorkOrder,
  worker: Employee,
  round: WorkRound,
  policyBlock: string,
  roundNumber: number
): string {
  return [
    `${worker.name} (${worker.title}) has submitted round ${Math.min(roundNumber, MAX_WORKER_ROUNDS)} of ${MAX_WORKER_ROUNDS} for this work order. Review it.`,
    "",
    `# WORK ORDER: ${order.title}`,
    `Deliverable type: ${order.deliverableType}`,
    "",
    "## Brief",
    order.brief,
    "",
    policyBlock,
    "",
    "## The deliverable submitted for review",
    round.draft.slice(0, 12000),
    "",
    "## The worker's decision requests",
    round.decisionRequests.length > 0
      ? JSON.stringify(round.decisionRequests, null, 2)
      : "(none)",
    "",
    `Write your review (what's good, what's wrong, what you resolved on the worker's decision requests). Then end with ONE fenced json block:
\`\`\`json
{
  "verdict": "approve | revise | escalate",
  "feedback": "required changes for the worker (only when verdict is revise)",
  "escalations": [
    { "question": "plain-English question for Chris", "reason": "why this needs the owner", "recommendation": "your recommended answer", "dollar_amount": 0 }
  ]
}
\`\`\`
Rules: "revise" only when the worker can realistically fix it${roundNumber >= MAX_WORKER_ROUNDS ? " — this is the FINAL round, so choose approve or escalate" : ""}; "escalate" when the blocker needs Chris; escalations must be empty unless verdict is escalate or a specific item truly needs him despite approval.`,
  ].join("\n");
}

// ---- The engine ---------------------------------------------------------------

export interface RunWorkOrderResult {
  order: WorkOrder;
  tokens: { input: number; output: number };
}

/**
 * Execute a work order: worker drafts → (if the position has a boss) manager
 * reviews → approve / bounded revise loop / escalate. Ends in "approved"
 * (owner's ship queue), "escalated" (owner's decision queue), or "error".
 */
export async function runWorkOrder(id: string): Promise<RunWorkOrderResult> {
  const startedAt = new Date();
  let order = await getWorkOrder(id);
  if (!order) throw new Error(`Work order not found: ${id}`);
  if (order.status !== "queued" && order.status !== "revision") {
    throw new Error(
      `Work order ${id} is "${order.status}" — only queued/revision orders can run.`
    );
  }

  const employee = getEmployeeById(order.assigneeId);
  const department = getDepartmentById(order.departmentId);
  if (!employee || !department) {
    throw new Error(`Unknown assignee or department on work order ${id}`);
  }
  if (!employee.enabled) {
    throw new Error(`${employee.name} is disabled in the org directory.`);
  }
  if (!employee.staffed) {
    throw new Error(
      `${employee.name} (${employee.title}) isn't staffed yet — the position exists in the org chart but its prompts land in a later phase.`
    );
  }

  const manager = getManagerOf(employee);
  const reviewer =
    manager && manager.staffed && manager.enabled && manager.id !== employee.id
      ? manager
      : undefined;

  const profile = getEmployeeProfile(employee.id);
  const tokens = { input: 0, output: 0 };

  try {
    const workerSystem = await buildWorkerSystemPrompt(employee, department);
    const policyBlock = await renderPolicyBlock(department.id, department.name);

    let roundNumber = order.rounds.length;
    let verdictReached = false;

    while (!verdictReached) {
      roundNumber += 1;

      // ---- Worker pass ----
      order = (await updateWorkOrder(order.id, { status: "in_progress" }))!;
      const lastReview = order.reviews[order.reviews.length - 1];
      const workerRes = await callClaude({
        systemPrompt: workerSystem,
        userMessage: buildWorkerUserMessage(
          order,
          policyBlock,
          profile?.deliverableGuidance
        ),
        model: employee.model ?? CLAUDE_MODEL,
        maxTokens: 3072,
        temperature: 0.4,
      });
      tokens.input += workerRes.inputTokens;
      tokens.output += workerRes.outputTokens;

      const round: WorkRound = {
        round: roundNumber,
        draft: stripJsonBlock(workerRes.text),
        decisionRequests: parseJsonArray(workerRes.text),
        feedback: lastReview?.feedback,
        at: new Date().toISOString(),
        tokens: { input: workerRes.inputTokens, output: workerRes.outputTokens },
      };

      // ---- No boss: straight to the owner's queue ----
      if (!reviewer) {
        const orderTitle = order.title;
        const escalations = round.decisionRequests
          .map((d) => ({
            question: String(d.question ?? d.description ?? "").trim(),
            reason: `Raised by ${employee.name} on "${orderTitle}" (no department manager — position reports to leadership)`,
            recommendation: d.recommendation
              ? String(d.recommendation)
              : undefined,
          }))
          .filter((e) => e.question.length > 0);
        const created = await addEscalations(department.id, escalations);
        order = (await updateWorkOrder(order.id, {
          rounds: [...order.rounds, round],
          escalationIds: [...order.escalationIds, ...created.map((e) => e.id)],
          status: created.length > 0 ? "escalated" : "approved",
          ownerNotes: undefined,
        }))!;
        verdictReached = true;
        break;
      }

      // ---- Boss review ----
      order = (await updateWorkOrder(order.id, {
        rounds: [...order.rounds, round],
        status: "in_review",
      }))!;
      const reviewRes = await callClaude({
        systemPrompt: await buildManagerSystemPrompt(reviewer, department),
        userMessage: buildManagerUserMessage(
          order,
          employee,
          round,
          policyBlock,
          roundNumber
        ),
        model: reviewer.model ?? CLAUDE_MANAGER_MODEL,
        maxTokens: 2048,
        temperature: 0.2,
      });
      tokens.input += reviewRes.inputTokens;
      tokens.output += reviewRes.outputTokens;

      const parsed = parseReviewBlock(reviewRes.text);
      // A revise verdict on the final round can't loop again — the boss was
      // told to pick approve/escalate, but guard anyway.
      const verdict =
        parsed.verdict === "revise" && roundNumber >= MAX_WORKER_ROUNDS
          ? "escalate"
          : parsed.verdict;

      const review: ManagerReview = {
        round: roundNumber,
        verdict,
        notes: stripJsonBlock(reviewRes.text),
        feedback: parsed.feedback,
        at: new Date().toISOString(),
        tokens: { input: reviewRes.inputTokens, output: reviewRes.outputTokens },
      };

      if (verdict === "revise") {
        order = (await updateWorkOrder(order.id, {
          reviews: [...order.reviews, review],
          status: "revision",
        }))!;
        continue; // next worker round with the boss's feedback
      }

      const escalations =
        verdict === "escalate" && parsed.escalations.length === 0
          ? [
              {
                question: `"${order.title}" (${department.name}) needs your call — ${reviewer.name} couldn't approve it. See the work order for the draft and review.`,
                reason:
                  parsed.feedback ??
                  `${reviewer.name} escalated after round ${roundNumber} without structured questions.`,
                recommendation: undefined,
              },
            ]
          : parsed.escalations;
      const created = await addEscalations(department.id, escalations);

      order = (await updateWorkOrder(order.id, {
        reviews: [...order.reviews, review],
        escalationIds: [...order.escalationIds, ...created.map((e) => e.id)],
        status: verdict === "approve" ? "approved" : "escalated",
        ownerNotes: undefined,
      }))!;
      verdictReached = true;
    }

    // Visibility: run log on the dashboard + a signal for the other teams.
    const finishedAt = new Date();
    await saveRunLogs([
      {
        id: `org-${order.id}`,
        agentId: employee.personaId ?? employee.id,
        agentName: `${employee.name} — ${order.title}`,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status: "success",
        output: [
          order.rounds[order.rounds.length - 1]?.draft ?? "",
          ...(order.reviews.length > 0
            ? [
                "\n\n---\n\n## Boss review",
                order.reviews[order.reviews.length - 1].notes,
              ]
            : []),
        ].join("\n"),
        model: employee.model ?? CLAUDE_MODEL,
        tokensUsed: tokens.input + tokens.output,
      },
    ]).catch(() => {});
    await postSignal({
      source: department.id,
      headline: `${employee.name}: "${order.title}" → ${order.status}${
        order.status === "approved" ? " (awaiting Chris's approve trigger)" : ""
      }`,
    }).catch(() => {});

    return { order, tokens };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    order = (await updateWorkOrder(order.id, {
      status: "error",
      error: message,
    }).catch(() => null)) ?? order;
    throw err;
  }
}

// ---- Owner actions (Chris keeps the trigger) -----------------------------------

/** The owner's approve trigger: ship a boss-approved work order. Runs the
 * department's ship executor (e.g. marketing content → approved Studio posts). */
export async function shipWorkOrder(
  id: string,
  shippedBy = "Chris Cook",
  notes?: string
): Promise<WorkOrder> {
  const order = await getWorkOrder(id);
  if (!order) throw new Error(`Work order not found: ${id}`);
  const shipNote = await executeShip(order);
  const updated = await updateWorkOrder(id, {
    status: "shipped",
    shippedAt: new Date().toISOString(),
    shippedBy,
    ownerNotes: notes,
    shipNote: shipNote ?? undefined,
  });
  await postSignal({
    source: order.departmentId,
    headline: `Chris approved "${order.title}" — shipped.${shipNote ? ` ${shipNote}` : ""}`,
  }).catch(() => {});
  return updated!;
}

/** Owner sends work back with notes; it re-runs as a new revision round. */
export async function sendBackWorkOrder(
  id: string,
  notes: string,
  by = "Chris Cook"
): Promise<WorkOrder> {
  const updated = await updateWorkOrder(id, {
    status: "revision",
    ownerNotes: `${notes} (— ${by})`,
  });
  if (!updated) throw new Error(`Work order not found: ${id}`);
  return updated;
}

/** Owner kills a work order. */
export async function rejectWorkOrder(
  id: string,
  notes?: string,
  by = "Chris Cook"
): Promise<WorkOrder> {
  const updated = await updateWorkOrder(id, {
    status: "rejected",
    ownerNotes: notes ? `${notes} (— ${by})` : undefined,
  });
  if (!updated) throw new Error(`Work order not found: ${id}`);
  return updated;
}
