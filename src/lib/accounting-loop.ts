// ---------------------------------------------------------------------------
// accounting-loop.ts — The worker → CFO → escalate orchestration
//
// This is the heart of the two-agent design:
//   1. Penny (worker) runs a task against Zoho Books and emits decision requests.
//   2. Sterling (CFO) reviews her work, resolves what policy/expertise allows,
//      and escalates only the rest to Chris — which lands in the Policy Ledger
//      as open questions.
//   3. Chris answers (via HQ chat or the daily digest) → answers become policy.
//
// Connection: uses the Zoho Books MCP connector when configured, and ALWAYS
// grounds the agents with a read-only REST snapshot as a reliable fallback.
// ---------------------------------------------------------------------------
import { callClaude, substituteVariables, type McpServer } from "./anthropic";
import { fetchBooksSnapshot, getZohoBooksMcpConfig } from "./zoho-books";
import { fetchInventorySnapshot } from "./zoho";
import { sendAnalyticsReport } from "./email";
import { saveRunLogs } from "./store";
import {
  renderPolicyBlock,
  addEscalations,
  getOpenEscalations,
  type Escalation,
} from "./policy-ledger";
import workerConfig from "@/agents/accounting-agent.config";
import cfoConfig from "@/agents/accounting-manager.config";

// ---- JSON-block parsing ---------------------------------------------------

/** Extract the LAST ```json fenced block from text and parse it as an array. */
export function parseJsonArray(text: string): Record<string, unknown>[] {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return [];
  const last = matches[matches.length - 1][1].trim();
  try {
    const parsed = JSON.parse(last);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mcpServers(): McpServer[] | undefined {
  const cfg = getZohoBooksMcpConfig();
  return cfg ? [cfg] : undefined;
}

// ---- Worker run -----------------------------------------------------------

export interface WorkerResult {
  output: string;
  decisionRequests: Record<string, unknown>[];
  inputTokens: number;
  outputTokens: number;
}

/** Run one of Penny's bookkeeping tasks. */
export async function runWorkerTask(
  task: string,
  extraContext = ""
): Promise<WorkerResult> {
  const taskPrompt = workerConfig.taskPrompts[task];
  if (!taskPrompt) {
    throw new Error(
      `Invalid accounting task "${task}". Valid: ${Object.keys(workerConfig.taskPrompts).join(", ")}`
    );
  }

  // Ground with a read-only books snapshot (REST). For the tie-out task, add
  // the inventory snapshot too.
  const parts = [await fetchBooksSnapshot()];
  if (task === "inventory-tieout") {
    parts.push(await fetchInventorySnapshot().catch((e) => `## ⚠️ Inventory snapshot unavailable\n${e}`));
  }
  if (extraContext.trim()) parts.push(`## Additional Context\n${extraContext}`);

  const userMessage = substituteVariables(taskPrompt, {
    context: parts.join("\n\n"),
    date: new Date().toISOString().slice(0, 10),
  });

  const res = await callClaude({
    systemPrompt: workerConfig.systemPrompt,
    userMessage,
    model: workerConfig.model,
    maxTokens: workerConfig.maxTokens,
    temperature: workerConfig.temperature,
    mcpServers: mcpServers(),
  });

  return {
    output: res.text,
    decisionRequests: parseJsonArray(res.text),
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  };
}

// ---- CFO review -----------------------------------------------------------

export interface CfoReviewResult {
  review: string;
  escalations: Record<string, unknown>[];
  inputTokens: number;
  outputTokens: number;
}

/** Sterling reviews Penny's work, resolving what he can and escalating the rest. */
export async function runCfoReview(
  workerOutput: string,
  decisionRequests: Record<string, unknown>[]
): Promise<CfoReviewResult> {
  const userMessage = substituteVariables(cfoConfig.reviewPrompt, {
    policy_block: await renderPolicyBlock(),
    worker_output: workerOutput,
    decision_requests: JSON.stringify(decisionRequests, null, 2),
  });

  const res = await callClaude({
    systemPrompt: cfoConfig.systemPrompt,
    userMessage,
    model: cfoConfig.model,
    maxTokens: cfoConfig.maxTokens,
    temperature: cfoConfig.temperature,
  });

  return {
    review: res.text,
    escalations: parseJsonArray(res.text),
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  };
}

// ---- Full cycle -----------------------------------------------------------

export interface AccountingCycleResult {
  task: string;
  workerOutput: string;
  cfoReview: string;
  newEscalations: Escalation[];
  tokens: { input: number; output: number };
}

/** Run a complete worker → CFO cycle and persist any new escalations. */
export async function runAccountingCycle(
  task: string,
  extraContext = ""
): Promise<AccountingCycleResult> {
  const worker = await runWorkerTask(task, extraContext);
  const cfo = await runCfoReview(worker.output, worker.decisionRequests);

  // Persist what Sterling decided to escalate to Chris.
  const newEscalations = await addEscalations(
    cfo.escalations
      .map((e) => ({
        question: String(e.question ?? "").trim(),
        reason: String(e.reason ?? "raised by CFO"),
        recommendation: e.recommendation ? String(e.recommendation) : undefined,
        dollarAmount:
          typeof e.dollar_amount === "number" ? e.dollar_amount : undefined,
      }))
      .filter((e) => e.question.length > 0)
  );

  return {
    task,
    workerOutput: worker.output,
    cfoReview: cfo.review,
    newEscalations,
    tokens: {
      input: worker.inputTokens + cfo.inputTokens,
      output: worker.outputTokens + cfo.outputTokens,
    },
  };
}

// ---- CFO chat -------------------------------------------------------------

export async function runCfoChat(message: string): Promise<string> {
  const open = await getOpenEscalations();
  const openBlock =
    open.length === 0
      ? "(none)"
      : open
          .map(
            (e, i) =>
              `${i + 1}. [${e.id}] ${e.question}${e.recommendation ? ` — your rec: ${e.recommendation}` : ""}`
          )
          .join("\n");

  const userMessage = substituteVariables(cfoConfig.chatPrompt, {
    policy_block: await renderPolicyBlock(),
    open_escalations: openBlock,
    message,
  });

  const res = await callClaude({
    systemPrompt: cfoConfig.systemPrompt,
    userMessage,
    model: cfoConfig.model,
    maxTokens: 2048,
    temperature: 0.3,
  });
  return res.text;
}

// ---- Daily CFO digest -----------------------------------------------------

export async function buildCfoDigest(activity = "(no automated runs since yesterday)"): Promise<{
  body: string;
  openCount: number;
}> {
  const open = await getOpenEscalations();
  const openBlock =
    open.length === 0
      ? "(none — nothing needs Chris right now)"
      : open
          .map(
            (e, i) =>
              `${i + 1}. ${e.question}\n   reason: ${e.reason}${e.recommendation ? `\n   Sterling's rec: ${e.recommendation}` : ""}${e.dollarAmount ? `\n   amount: $${e.dollarAmount}` : ""}`
          )
          .join("\n");

  const userMessage = substituteVariables(cfoConfig.digestPrompt, {
    policy_block: await renderPolicyBlock(),
    open_escalations: openBlock,
    activity,
    date: new Date().toISOString().slice(0, 10),
  });

  const res = await callClaude({
    systemPrompt: cfoConfig.systemPrompt,
    userMessage,
    model: cfoConfig.model,
    maxTokens: 2048,
    temperature: 0.3,
  });

  return { body: res.text, openCount: open.length };
}

/**
 * Build the daily CFO digest, email it to Chris, and persist a run log.
 * Shared by the /api/accounting-manager route and the daily cron.
 */
export async function sendCfoDigestEmail(email = true): Promise<{
  body: string;
  openCount: number;
}> {
  const startedAt = new Date();
  const { body, openCount } = await buildCfoDigest();

  if (email) {
    const emailTo =
      process.env.REPORT_EMAIL_TO?.split(",").map((e) => e.trim()) ??
      cfoConfig.email.to;
    await sendAnalyticsReport({
      to: emailTo,
      from: cfoConfig.email.from,
      subject: `CFO Digest — ${startedAt.toISOString().slice(0, 10)}${openCount > 0 ? ` (${openCount} need your call)` : ""}`,
      reportText: body,
    });
  }

  const finishedAt = new Date();
  await saveRunLogs([
    {
      id: `accounting-manager-digest-${startedAt.toISOString()}`,
      agentId: "accounting-manager",
      agentName: "Sterling Vance (Daily Digest)",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: "success",
      output: body,
      model: cfoConfig.model,
    },
  ]);

  return { body, openCount };
}
