import { CLAUDE_MODEL } from "@/lib/models";
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
import { fetchInventorySnapshot, fetchOpenPurchaseOrders } from "./zoho";
import { fetchSheetSnapshot } from "./zoho-sheet";
import { fetchSyncReport } from "./zoho-sync";
import { sendAnalyticsReport } from "./email";
import { saveRunLogs, getRunLogsByAgent } from "./store";
import {
  renderPolicyBlock,
  addEscalations,
  getOpenEscalations,
  type Escalation,
} from "./policy-ledger";
import { runCategorizationBatch } from "./accounting-execute";
import { buildQuestionsWorkbook } from "./questions-export";
import { getDocuments, renderDocumentsBlock } from "./documents";
import { renderApInboxSnapshot } from "./zoho-documents";
import { buildStrategistContext } from "./strategist-context";
import { renderOrgKnowledge } from "./org-knowledge";
import { renderCrossAgentSignals } from "./cross-agent";
import {
  loadCfoChat,
  saveCfoChat,
  needsCompaction,
  splitForCompaction,
  type ChatAgent,
} from "./cfo-chat-store";
import {
  isInboxConfigured,
  fetchInteracNotifications,
  renderInteracBlock,
} from "./email-inbox";
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

  // Ground with a read-only books snapshot (REST). The tie-out task also needs
  // Stockton's world: the master Sheet (SOURCE OF TRUTH for stick counts), his
  // Sheet↔Inventory reconciliation, and the Inventory snapshot (stock + costs
  // for dollar valuation).
  const parts = [await fetchBooksSnapshot()];
  if (task === "inventory-tieout") {
    const safe = (label: string, p: Promise<string>) =>
      p.catch((e) => `## ⚠️ ${label} unavailable\n${e instanceof Error ? e.message : String(e)}`);
    const [sheet, sync, inventory] = await Promise.all([
      safe("Master Sheet snapshot (source of truth)", fetchSheetSnapshot()),
      safe("Stockton's Sheet↔Inventory reconciliation", fetchSyncReport()),
      safe("Zoho Inventory snapshot (for valuation)", fetchInventorySnapshot()),
    ]);
    parts.push(sheet, sync, inventory);
  }

  // Reference documents Chris uploaded (bank statements, detail exports) —
  // this is how "check my spreadsheet against Books" reaches Penny.
  const docs = await getDocuments().catch(() => []);
  if (docs.length > 0) {
    parts.push(
      `## Reference Documents Uploaded by Chris (compare against the books where relevant)\n${renderDocumentsBlock(docs, 10_000)}`
    );
  }

  // Committed purchase orders — the cash-outlook's "cash out" side.
  if (task === "cash-outlook") {
    const pos = await fetchOpenPurchaseOrders().catch(() => []);
    parts.push(
      pos.length === 0
        ? "## Open Purchase Orders\n(none — no committed PO outflows)"
        : `## Open Purchase Orders (committed cash out)\n${pos
            .map(
              (po) =>
                `- ${po.purchaseorder_number} | ${po.vendor_name} | $${po.total.toFixed(2)} | expected ${po.expected_delivery_date || "TBD"} | ${po.status}`
            )
            .join("\n")}`
    );
  }

  // Interac e-Transfer notification emails — identify the senders behind
  // anonymous bank-feed e-Transfers (and match deposits to invoices for
  // collections).
  if (
    isInboxConfigured() &&
    ["categorize-transactions", "bank-reconciliation", "ar-collections", "cash-outlook"].includes(task)
  ) {
    const interac = await fetchInteracNotifications().catch(() => []);
    if (interac.length > 0) parts.push(renderInteracBlock(interac));
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

/** Tasks Sterling is allowed to dispatch to Penny from the chat. */
export const DISPATCHABLE_TASKS = new Set([
  "auto-categorize",
  ...Object.keys(workerConfig.taskPrompts),
]);

export interface CfoChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CfoChatResult {
  reply: string;
  /** Task Sterling decided to dispatch to Penny (validated), if any. */
  dispatch: string | null;
  /** Escalation answers Sterling extracted from Chris's message. */
  resolutions: Array<{ id: string; answer: string }>;
}

/** Parse Sterling's trailing control block: { dispatch, resolutions }. */
function parseControlBlock(text: string): {
  reply: string;
  dispatch: string | null;
  resolutions: Array<{ id: string; answer: string }>;
} {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return { reply: text.trim(), dispatch: null, resolutions: [] };
  const last = matches[matches.length - 1];
  try {
    const parsed = JSON.parse(last[1].trim()) as {
      dispatch?: unknown;
      resolutions?: unknown;
    };
    if (parsed && typeof parsed === "object" && ("dispatch" in parsed || "resolutions" in parsed)) {
      const dispatch =
        typeof parsed.dispatch === "string" && DISPATCHABLE_TASKS.has(parsed.dispatch)
          ? parsed.dispatch
          : null;
      const resolutions = Array.isArray(parsed.resolutions)
        ? parsed.resolutions
            .map((r) => ({
              id: String((r as Record<string, unknown>)?.id ?? ""),
              answer: String((r as Record<string, unknown>)?.answer ?? "").trim(),
            }))
            .filter((r) => r.id.startsWith("esc-") && r.answer.length > 0)
        : [];
      // Strip the machine-read block from what Chris sees.
      const reply = text.replace(last[0], "").trim();
      return { reply, dispatch, resolutions };
    }
  } catch {
    /* not a control block — leave the reply intact */
  }
  return { reply: text.trim(), dispatch: null, resolutions: [] };
}

/**
 * Shared chat runner for both accounting agents (Sterling and Penny). Handles
 * persistent memory: the KV-stored transcript is the source of truth (the
 * client-sent history is only a fallback for sessions predating persistence),
 * each exchange is saved, and long transcripts compact into a rolling summary
 * instead of being forgotten.
 */
async function runAgentChat(
  agent: ChatAgent,
  message: string,
  clientHistory: CfoChatMessage[] = [],
  options: { concise?: boolean; images?: { mediaType: string; data: string }[] } = {}
): Promise<CfoChatResult> {
  const speaker = agent === "sterling" ? "Sterling" : "Penny";
  const stored = await loadCfoChat(agent);
  const effectiveHistory: CfoChatMessage[] =
    stored.messages.length > 0
      ? stored.messages.map((m) => ({ role: m.role, content: m.content }))
      : clientHistory;

  const open = await getOpenEscalations();
  const openBlock =
    open.length === 0
      ? "(none)"
      : open
          .map(
            (e, i) =>
              `${i + 1}. [${e.id}] ${e.question}${e.recommendation ? ` — recommendation on file: ${e.recommendation}` : ""}`
          )
          .join("\n");

  // Penny's most recent findings — shared knowledge for BOTH agents (it's her
  // work; Sterling reviews it). Keep only the FRESHEST report per task so a
  // superseded run doesn't resurface already-resolved issues.
  const pennyLogs = await getRunLogsByAgent("accounting");
  const seenTasks = new Set<string>();
  const freshest = pennyLogs.filter((l) => {
    if (seenTasks.has(l.agentName)) return false;
    seenTasks.add(l.agentName);
    return true;
  });
  const pennyWork =
    freshest.length === 0
      ? "(Penny hasn't produced any reports yet — no live findings to reference.)"
      : freshest
          .slice(0, 3)
          .map(
            (l) =>
              `### ${l.agentName} — ${l.startedAt.slice(0, 10)}\n${l.output.slice(0, 6000)}`
          )
          .join("\n\n---\n\n");

  const historyBlock = [
    stored.summary
      ? `Summary of earlier conversation (compacted):\n${stored.summary}`
      : "",
    effectiveHistory.length === 0
      ? "(no prior messages)"
      : effectiveHistory
          .slice(-12)
          .map((m) => `${m.role === "user" ? "Chris" : speaker}: ${m.content.slice(0, 1500)}`)
          .join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const docs = await getDocuments().catch(() => []);
  const apInbox = await renderApInboxSnapshot().catch(() => "");

  const config = agent === "sterling" ? cfoConfig : workerConfig;
  let userMessage = substituteVariables(config.chatPrompt, {
    policy_block: await renderPolicyBlock(),
    open_escalations: openBlock,
    penny_work: pennyWork,
    documents: renderDocumentsBlock(docs, 12_000),
    history: historyBlock,
    message,
  });
  // The Zoho Books Documents inbox (AP bills awaiting entry) — appended so both
  // Penny (who proposes the entries) and Sterling (who reviews) can see it.
  if (apInbox) userMessage += `\n\n${apInbox}`;

  // Every agent shares the company knowledge; Sterling additionally gets the
  // financial-strategist context (Tilt Business Strategist + pipeline/projection).
  const systemPrompt =
    config.systemPrompt +
    (await renderOrgKnowledge().catch(() => "")) +
    (await renderCrossAgentSignals(agent === "sterling" ? "sterling" : "penny").catch(() => "")) +
    (agent === "sterling" ? await buildStrategistContext().catch(() => "") : "") +
    // Voice Mode: the reply is read ALOUD to someone driving — keep it short and
    // ear-friendly. (Same brain and context; only the delivery changes.)
    (options.concise
      ? "\n\n=== HANDS-FREE / DRIVING MODE ===\nThe user is talking to you by voice while driving; your reply is spoken aloud, not shown on screen. Answer in 1–3 short, natural sentences: lead with the answer, then at most one key number or next step. NO markdown, headings, bullet lists, tables, or code blocks — it all gets read out literally. If the full detail is long, give the headline out loud and offer to drop the rest on their screen for later. Speak numbers naturally (say “about twelve thousand dollars,” not a table)."
      : "");

  const images = options.images ?? [];
  const res = await callClaude({
    systemPrompt,
    userMessage: images.length
      ? `${userMessage}\n\n(${images.length} screenshot${images.length > 1 ? "s" : ""} attached above — look at ${images.length > 1 ? "them" : "it"} carefully; ${images.length > 1 ? "they are" : "it is"} what Chris is talking about.)`
      : userMessage,
    model: config.model,
    maxTokens: 4096,
    temperature: 0.3,
    images,
  });
  const result = parseControlBlock(res.text);

  // Safety net: the reply must never be empty. It can come back blank when the
  // model returns ONLY the fenced control block (no prose) — stripping it then
  // leaves nothing, and the chat renders an empty bubble ("no response"). Fall
  // back to a plain-English acknowledgement of whatever action it took.
  if (!result.reply.trim()) {
    console.warn(
      `[accounting-loop] ${agent} returned an empty reply (raw text length ${res.text.length}) — using fallback.`
    );
    result.reply = result.dispatch
      ? `On it — I've put Penny on "${result.dispatch}". Results will land in her Report History, and any new questions right here, in a minute or two.`
      : result.resolutions.length > 0
        ? `Recorded — that's standing policy now, so I won't ask again.`
        : "Sorry — I didn't get that one out cleanly. Give me a touch more to go on and I'll take another run at it.";
  }

  // Persist the exchange (compacts into a running summary when long). The
  // transcript is text-only, so note the attachment rather than storing base64.
  const storedMessage = images.length
    ? `[${images.length} screenshot${images.length > 1 ? "s" : ""} attached] ${message}`
    : message;
  await persistCfoChatTurn(agent, storedMessage, result.reply);

  return result;
}

/**
 * Append one user→assistant turn to an accounting agent's persistent transcript
 * (Vercel KV), compacting into a running summary when it grows too long. Shared
 * by the typed chat (runAgentChat) and the streaming Voice Mode path so both
 * write to the SAME store identically. Best-effort — persistence must never
 * break the chat.
 */
export async function persistCfoChatTurn(
  agent: ChatAgent,
  userMessage: string,
  reply: string
): Promise<void> {
  const speaker = agent === "sterling" ? "Sterling" : "Penny";
  const stored = await loadCfoChat(agent);
  const now = new Date().toISOString();
  const nextState = {
    summary: stored.summary,
    messages: [
      ...stored.messages,
      { role: "user" as const, content: userMessage, timestamp: now },
      { role: "assistant" as const, content: reply, timestamp: now },
    ],
  };
  try {
    if (needsCompaction(nextState)) {
      const { older, recent } = splitForCompaction(nextState);
      const olderText = older
        .map((m) => `${m.role === "user" ? "Chris" : speaker}: ${m.content.slice(0, 1200)}`)
        .join("\n");
      const sum = await callClaude({
        systemPrompt:
          "You maintain a running summary of an accounting chat between Chris (CEO of Tilt Hockey) and his accounting agent. Fold the new messages into the existing summary. PRESERVE: every decision made, every dollar figure, account names, vendor/customer identities, open threads, and anything Chris said about how Tilt operates. DROP: pleasantries and process chatter. Output only the updated summary, under 400 words.",
        userMessage: `EXISTING SUMMARY:\n${nextState.summary || "(none)"}\n\nNEW MESSAGES TO FOLD IN:\n${olderText}`,
        model: CLAUDE_MODEL,
        maxTokens: 800,
        temperature: 0.2,
      });
      await saveCfoChat({ summary: sum.text.trim(), messages: recent }, agent);
    } else {
      await saveCfoChat(nextState, agent);
    }
  } catch (err) {
    // Memory persistence must never break the chat itself.
    console.warn(`[accounting-loop] chat persistence failed (${agent}):`, err);
  }
}

export async function runCfoChat(
  message: string,
  history: CfoChatMessage[] = [],
  options: { concise?: boolean; images?: { mediaType: string; data: string }[] } = {}
): Promise<CfoChatResult> {
  return runAgentChat("sterling", message, history, options);
}

export async function runPennyChat(
  message: string,
  history: CfoChatMessage[] = [],
  options: { concise?: boolean; images?: { mediaType: string; data: string }[] } = {}
): Promise<CfoChatResult> {
  return runAgentChat("penny", message, history, options);
}

/**
 * Run a task Sterling dispatched from the chat. Executes the fast single-call
 * variant (Penny only), persists the run log, and routes her decision requests
 * into the escalation queue — same as clicking the button on her page.
 */
export async function runDispatchedTask(task: string): Promise<void> {
  const startedAt = new Date();
  try {
    if (task === "auto-categorize") {
      const result = await runCategorizationBatch({ limit: 15 });
      await saveRunLogs([
        {
          id: `accounting-execute-${result.batchId}`,
          agentId: "accounting",
          agentName: `Penny Quill (Auto-Categorize${result.mode === "proposed" ? " — Dry Run" : ""})`,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          status: "success",
          output: result.report,
          model: CLAUDE_MODEL,
        },
      ]);
      return;
    }

    const worker = await runWorkerTask(task);
    await addEscalations(
      worker.decisionRequests
        .map((d) => ({
          question: String(d.description ?? d.question ?? "").trim(),
          reason: `Raised by Penny during ${task} (dispatched by Sterling)`,
          recommendation: d.recommendation ? String(d.recommendation) : undefined,
          dollarAmount: typeof d.dollar_amount === "number" ? d.dollar_amount : undefined,
        }))
        .filter((e) => e.question.length > 0)
    );
    await saveRunLogs([
      {
        id: `accounting-${task}-${startedAt.toISOString()}`,
        agentId: "accounting",
        agentName: `Penny Quill (${task} — via Sterling)`,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: "success",
        output: worker.output,
        model: workerConfig.model,
      },
    ]);
  } catch (err) {
    await saveRunLogs([
      {
        id: `accounting-${task}-${startedAt.toISOString()}`,
        agentId: "accounting",
        agentName: `Penny Quill (${task} — via Sterling)`,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: "error",
        output: err instanceof Error ? err.message : String(err),
        model: workerConfig.model,
      },
    ]);
  }
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
    // Attach the open questions as a fill-in spreadsheet: answer the YOUR
    // ANSWER column and re-upload it in Sterling's chat to record in bulk.
    const questionsWb =
      openCount > 0 ? await buildQuestionsWorkbook().catch(() => null) : null;
    await sendAnalyticsReport({
      to: emailTo,
      from: cfoConfig.email.from,
      subject: `CFO Digest — ${startedAt.toISOString().slice(0, 10)}${openCount > 0 ? ` (${openCount} need your call)` : ""}`,
      reportText: questionsWb
        ? `${body}\n\n---\nAttached: ${questionsWb.filename} — fill in the YOUR ANSWER column and upload it back in my chat (📎) to record all your answers at once.`
        : body,
      attachments: questionsWb
        ? [{ filename: questionsWb.filename, content: questionsWb.buffer }]
        : undefined,
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
