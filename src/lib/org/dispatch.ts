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
import { callClaudeToCompletion } from "../anthropic";
import { CLAUDE_MANAGER_MODEL } from "../models";
import {
  getDepartmentById,
  getDirectReports,
  getEmployeeById,
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
  executive:
    "You are dispatching to DEPARTMENT HEADS, not to individual contributors — each piece you assign lands with a boss who will run it through their own team. So brief at their altitude: name the outcome the founders need and why it matters now, and leave the how to them. Spread the load across departments rather than stacking three pieces on one head, and don't dispatch work a department is already doing on its own cadence. If something needs one specific person deeper in the org, say so in the brief and let their boss route it.",
  marketing:
    "Respect the weekly cadence in the brand bar across Instagram, TikTok, and Facebook, hit a healthy mix of pillars, and lean into the priority format (short video). Prefer pieces the asset library can actually support; when a piece needs footage that isn't available, say so in its brief so it surfaces as a gap.",
  product:
    "Balance near-term product work (specs, RFQs, catalog) against research that feeds next season. Every dispatched piece should move a real Tilt product forward — name which one in the brief.",
  intelligence:
    "Aim each piece at a decision another department is about to make — marketing's next push, a pricing call, a product bet. Every brief should end in a concrete Tilt move, not just an observation. Separate confirmed facts from inference and name the source.",
  sales:
    "Prioritize open team orders that are ready to send to vendors (dispatch one 'consolidate & route the {team} order' piece each), and any consignment accounts with un-invoiced orders (an audit piece). Don't dispatch an order to vendors if it's missing sizes or specs — flag the gap instead.",
  bizdev:
    "Keep the funnel moving: a research piece to find fresh prospects in a named segment/geography, a qualification piece to score what research found, and an outreach piece to write first-touch emails to the HOT leads. Grassroots and honest — quality prospects that fit Tilt's model beat a long list, and first-touch stays relational (no pricing, no pitch).",
  cx:
    "Dispatch a triage piece for each open warranty claim and a support-reply piece for any customer situation that needs a written response. Fair and fast on real defects; kind and clear on wear/misuse. Name the specific claim or customer in each brief.",
  finance:
    "Lean on the Financial Analyst for forward-looking work — cash-flow runway, projections, budget-vs-actual, and the margin reality on real orders. Leave day-to-day bookkeeping to Penny's own loop; dispatch analysis that helps the founders decide.",
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

/**
 * Who this department's boss can dispatch to.
 *
 * The reporting line is the edge, not department membership. That distinction
 * only matters at the top: the Chief of Staff's reports ARE the department
 * heads, who each sit in their own department, so filtering by department gave
 * him an empty roster and no way to push work down. For every other boss the
 * two rules select exactly the same people, since their reports sit alongside
 * them.
 */
function dispatchableWorkers(dept: Department): Map<string, Employee> {
  const map = new Map<string, Employee>();
  if (!dept.managerId) return map;
  for (const e of getDirectReports(dept.managerId)) {
    if (e.id !== dept.managerId && e.staffed && e.enabled) {
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
  opts: { maxPieces?: number; run?: boolean; direction?: string } = {}
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
  // Direction from above (the Chief of Staff relaying the founders, or a human
  // note on the dispatch button). It outranks the department's own read of the
  // period, so it goes first and says so.
  const directionBlock = opts.direction?.trim()
    ? `## DIRECTION FROM THE FOUNDERS (via the Chief of Staff) — this takes priority over your own read of the period\n${opts.direction.trim()}\n\n`
    : "";

  const userMessage = `${directionBlock}Plan this period's ${dept.name} work and dispatch it to your team as work orders.

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

  // ToCompletion: the plan ends in a fenced json block, and a plan cut off by
  // the token cap loses the fence — which parses as an EMPTY plan and
  // dispatches zero pieces with no error anywhere.
  const res = await callClaudeToCompletion({
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
