// ---------------------------------------------------------------------------
// pipelines/marketing.ts — Harper runs the week
//
// The Marketing department's scheduled heartbeat. Harper Slate (Director)
// looks at the brand bar, the live plan, its gaps, competitor intel, and site
// performance, and DISPATCHES the week as structured work orders to her team.
// Each piece then flows through the engine: the creator drafts → Harper
// reviews → it lands in Chris's approval queue (Chris keeps the ship trigger).
//
// Opt-in on the cron via MARKETING_CRON=true, same pattern as the social plan.
// ---------------------------------------------------------------------------
import { callClaude } from "../anthropic";
import { CLAUDE_MANAGER_MODEL } from "../models";
import { renderMarketingContext } from "../org/marketing-context";
import { renderPolicyBlock } from "../org/ledger";
import { getEmployeesByDepartment } from "../org/directory";
import { createWorkOrder } from "../org/work-orders";
import { runWorkOrder } from "../org/engine";
import { postSignal } from "../signals";
import { saveRunLogs } from "../store";

const DIRECTOR_ID = "marketing-director";
const DEPARTMENT_ID = "marketing";

interface PlannedPiece {
  assignee: string;
  title: string;
  brief: string;
  deliverableType: string;
}

/** The workers Harper may dispatch to — staffed marketing reports. */
function dispatchableWorkers(): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of getEmployeesByDepartment(DEPARTMENT_ID)) {
    if (e.reportsTo === DIRECTOR_ID && e.staffed && e.enabled) {
      map.set(e.id, `${e.name} — ${e.title}`);
    }
  }
  return map;
}

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
          deliverableType: String(item.deliverableType ?? "post-copy").trim(),
        };
      })
      .filter(
        (p) => valid.has(p.assignee) && p.title.length > 0 && p.brief.length > 0
      );
  } catch {
    return [];
  }
}

async function planWeek(maxPieces: number): Promise<{
  pieces: PlannedPiece[];
  planText: string;
  tokens: { input: number; output: number };
}> {
  const workers = dispatchableWorkers();
  const roster = [...workers.entries()]
    .map(([id, label]) => `- ${id} — ${label}`)
    .join("\n");
  const context = await renderMarketingContext({ includeAnalytics: true });
  const policy = await renderPolicyBlock(DEPARTMENT_ID, "Marketing");

  const systemPrompt = `You are Harper Slate, Marketing Director at Tilt Hockey Inc. — a challenger hockey brand ("Don't be a sheep": premium custom sticks and apparel at a fraction of Bauer/CCM prices). You are planning and DISPATCHING this week's content to your team.

${policy}
${context}`;

  const userMessage = `Plan this week's marketing content and dispatch it to your team as work orders.

YOUR TEAM (assign each piece to one of these ids):
${roster}

Respect the weekly cadence in the brand bar across Instagram, TikTok, and Facebook, hit a healthy mix of pillars, and lean into the priority format (short video). Prefer pieces the asset library can actually support; when a piece needs footage/photography that isn't available, say so in its brief so it surfaces as a gap.

First, a short paragraph of your direction for the week (the theme and why). Then end with ONE fenced json block: an array of AT MOST ${maxPieces} work orders, highest-leverage first:
\`\`\`json
[
  {
    "assignee": "one of the team ids above",
    "title": "short work-order title",
    "brief": "a specific, executable brief — platform, pillar, hook/angle, format, and any asset need",
    "deliverableType": "video-script | post-copy | image-brief | seo-brief | posting-schedule"
  }
]
\`\`\``;

  const res = await callClaude({
    systemPrompt,
    userMessage,
    model: CLAUDE_MANAGER_MODEL,
    maxTokens: 2560,
    temperature: 0.5,
  });

  const pieces = parsePlan(res.text, new Set(workers.keys())).slice(0, maxPieces);
  return {
    pieces,
    planText: res.text,
    tokens: { input: res.inputTokens, output: res.outputTokens },
  };
}

export interface MarketingWeeklyResult {
  dispatched: number;
  approved: number;
  escalated: number;
  errored: number;
  workOrderIds: string[];
}

/**
 * Run the marketing week: Harper plans → work orders created → each executed
 * through the engine (creator → Harper review → owner queue).
 *
 * @param opts.maxPieces  cap on pieces Harper dispatches (cost/time guard)
 * @param opts.run        execute each work order now (default true). When
 *                        false, orders are created queued for later running.
 */
export async function runMarketingWeekly(
  opts: { maxPieces?: number; run?: boolean } = {}
): Promise<MarketingWeeklyResult> {
  const maxPieces = opts.maxPieces ?? 4;
  const run = opts.run ?? true;
  const startedAt = new Date();

  const { pieces, planText } = await planWeek(maxPieces);

  // Record Harper's plan itself so it's visible in run history + the brief.
  await saveRunLogs([
    {
      id: `marketing-plan-${startedAt.toISOString()}`,
      agentId: DIRECTOR_ID,
      agentName: "Harper Slate (Weekly Plan)",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: "success",
      output: planText,
      model: CLAUDE_MANAGER_MODEL,
    },
  ]).catch(() => {});

  const result: MarketingWeeklyResult = {
    dispatched: pieces.length,
    approved: 0,
    escalated: 0,
    errored: 0,
    workOrderIds: [],
  };

  for (const piece of pieces) {
    const order = await createWorkOrder({
      departmentId: DEPARTMENT_ID,
      assigneeId: piece.assignee,
      title: piece.title,
      brief: piece.brief,
      deliverableType: piece.deliverableType,
      createdBy: "Harper Slate (Marketing Director)",
    });
    result.workOrderIds.push(order.id);

    if (!run) continue;
    try {
      const { order: done } = await runWorkOrder(order.id);
      if (done.status === "approved") result.approved += 1;
      else if (done.status === "escalated") result.escalated += 1;
    } catch (err) {
      result.errored += 1;
      console.error(`[marketing] work order ${order.id} failed:`, err);
    }
  }

  await postSignal({
    source: DEPARTMENT_ID,
    headline: `Harper dispatched ${result.dispatched} pieces — ${result.approved} awaiting Chris's approval${
      result.escalated > 0 ? `, ${result.escalated} escalated` : ""
    }.`,
  }).catch(() => {});

  return result;
}
