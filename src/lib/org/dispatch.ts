// ---------------------------------------------------------------------------
// org/dispatch.ts — a department boss plans the period and dispatches work
//
// The generalization of Harper's weekly marketing dispatch to ANY department
// with a staffed manager: the boss reads their department context (live data)
// + policy ledger + roster, writes a short plan, and emits structured work
// orders for their team. Each order then runs through the engine
// (worker → boss review → Chris's queue).
//
// Marketing keeps its richer planning guidance via DISPATCH_INSTRUCTIONS.
// ---------------------------------------------------------------------------
import { callClaude } from "../anthropic";
import { CLAUDE_MANAGER_MODEL } from "../models";
import {
  getDepartmentById,
  getEmployeeById,
  getEmployeesByDepartment,
} from "./directory";
import { renderDepartmentContext } from "./department-context";
import { renderPolicyBlock } from "./ledger";
import { renderOrgKnowledge } from "../org-knowledge";
import { createWorkOrder } from "./work-orders";
import { runWorkOrder } from "./engine";
import { recordDispatch } from "./dispatch-cadence";
import { getEmployeeProfile } from "./employee-configs";
import { postSignal } from "../signals";
import { saveRunLogs } from "../store";
import type { Department, Employee } from "./types";

interface PlannedPiece {
  assignee: string;
  title: string;
  brief: string;
  deliverableType: string;
}

/** Department-specific planning guidance layered onto the generic prompt. */
const DISPATCH_INSTRUCTIONS: Record<string, string> = {
  marketing:
    "Respect the weekly cadence in the brand bar across Instagram, TikTok, and Facebook, hit a healthy mix of pillars, and lean into the priority format (short video). Prefer pieces the asset library can actually support; when a piece needs footage that isn't available, say so in its brief so it surfaces as a gap.",
  product:
    "Balance near-term product work (specs, RFQs, catalog) against research that feeds next season. Every dispatched piece should move a real Tilt product forward — name which one in the brief.",
  intelligence:
    "Aim each piece at a decision another department is about to make — marketing's next push, a pricing call, a product bet. Every brief should end in a concrete Tilt move, not just an observation. Separate confirmed facts from inference and name the source.",
};

function parsePlan(text: string, valid: Set<string>): PlannedPiece[] {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return [];
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1].trim());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => {
        const item = p as Record<string, unknown>;
        return {
          assignee: String(item.assignee ?? "").trim(),
          title: String(item.title ?? "").trim(),
          brief: String(item.brief ?? "").trim(),
          deliverableType: String(item.deliverableType ?? "report").trim(),
        };
      })
      .filter(
        (p) => valid.has(p.assignee) && p.title.length > 0 && p.brief.length > 0
      );
  } catch {
    return [];
  }
}

function dispatchableWorkers(dept: Department): Map<string, Employee> {
  const map = new Map<string, Employee>();
  for (const e of getEmployeesByDepartment(dept.id)) {
    if (e.reportsTo === dept.managerId && e.staffed && e.enabled) {
      map.set(e.id, e);
    }
  }
  return map;
}

export interface DispatchResult {
  departmentId: string;
  dispatched: number;
  approved: number;
  escalated: number;
  errored: number;
  workOrderIds: string[];
}

/**
 * The boss of `departmentId` plans and dispatches work orders to their team,
 * then (by default) runs each through the engine. Throws when the department
 * has no staffed manager or no staffed reports.
 */
export async function runDepartmentDispatch(
  departmentId: string,
  opts: { maxPieces?: number; run?: boolean } = {}
): Promise<DispatchResult> {
  const maxPieces = opts.maxPieces ?? 4;
  const run = opts.run ?? true;
  const startedAt = new Date();

  const dept = getDepartmentById(departmentId);
  if (!dept) throw new Error(`Unknown department: ${departmentId}`);
  const manager = dept.managerId ? getEmployeeById(dept.managerId) : undefined;
  if (!manager || !manager.staffed || !manager.enabled) {
    throw new Error(
      `${dept.name} has no staffed manager to run a dispatch — assign work orders directly instead.`
    );
  }
  const workers = dispatchableWorkers(dept);
  if (workers.size === 0) {
    throw new Error(`${dept.name} has no staffed team members to dispatch to.`);
  }

  // Manual and scheduled dispatches both reset the every-N-days cadence clock.
  await recordDispatch(departmentId).catch(() => {});

  const roster = [...workers.values()]
    .map((e) => `- ${e.id} — ${e.name}, ${e.title} (skills: ${e.skills.join(", ")})`)
    .join("\n");
  const [context, policy, knowledge] = await Promise.all([
    renderDepartmentContext(manager).catch(() => ""),
    renderPolicyBlock(departmentId, dept.name),
    renderOrgKnowledge().catch(() => ""),
  ]);

  const profile = getEmployeeProfile(manager.id);
  const systemPrompt = `${
    profile?.systemPrompt ??
    `You are ${manager.name}, ${manager.title} at Tilt Hockey Inc., the boss of the ${dept.name} department.\n\nDEPARTMENT MISSION: ${dept.mission}`
  }
${knowledge}

${policy}
${context}`;

  const extra = DISPATCH_INSTRUCTIONS[departmentId];
  const userMessage = `Plan this period's ${dept.name} work and dispatch it to your team as work orders.

YOUR TEAM (assign each piece to one of these ids):
${roster}

${extra ? `${extra}\n\n` : ""}First, a short paragraph of your direction for the period (the priorities and why, grounded in the live data above). Then end with ONE fenced json block: an array of AT MOST ${maxPieces} work orders, highest-leverage first:
\`\`\`json
[
  {
    "assignee": "one of the team ids above",
    "title": "short work-order title",
    "brief": "a specific, executable brief the assignee can act on without guessing",
    "deliverableType": "a slug matching the assignee's skills"
  }
]
\`\`\``;

  const res = await callClaude({
    systemPrompt,
    userMessage,
    model: manager.model ?? CLAUDE_MANAGER_MODEL,
    maxTokens: 2560,
    temperature: 0.5,
  });
  const pieces = parsePlan(res.text, new Set(workers.keys())).slice(0, maxPieces);

  await saveRunLogs([
    {
      id: `${departmentId}-dispatch-${startedAt.toISOString()}`,
      agentId: manager.personaId ?? manager.id,
      agentName: `${manager.name} (${dept.name} Dispatch)`,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: "success",
      output: res.text,
      model: manager.model ?? CLAUDE_MANAGER_MODEL,
    },
  ]).catch(() => {});

  const result: DispatchResult = {
    departmentId,
    dispatched: pieces.length,
    approved: 0,
    escalated: 0,
    errored: 0,
    workOrderIds: [],
  };

  for (const piece of pieces) {
    const order = await createWorkOrder({
      departmentId,
      assigneeId: piece.assignee,
      title: piece.title,
      brief: piece.brief,
      deliverableType: piece.deliverableType,
      createdBy: `${manager.name} (${manager.title})`,
    });
    result.workOrderIds.push(order.id);

    if (!run) continue;
    try {
      const { order: done } = await runWorkOrder(order.id);
      if (done.status === "approved") result.approved += 1;
      else if (done.status === "escalated") result.escalated += 1;
    } catch (err) {
      result.errored += 1;
      console.error(`[dispatch:${departmentId}] ${order.id} failed:`, err);
    }
  }

  if (result.dispatched > 0) {
    // When run=false (the two-phase client flow), the boss has only planned and
    // handed out the orders — the team runs them next, each posting its own
    // signal on completion. Report accordingly so the feed isn't misleading.
    const headline = run
      ? `${manager.name} dispatched ${result.dispatched} pieces — ${result.approved} awaiting Chris's approval${
          result.escalated > 0 ? `, ${result.escalated} escalated` : ""
        }.`
      : `${manager.name} planned ${result.dispatched} pieces and dispatched them to the team.`;
    await postSignal({ source: departmentId, headline }).catch(() => {});
  }

  return result;
}
