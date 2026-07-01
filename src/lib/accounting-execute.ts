// ---------------------------------------------------------------------------
// accounting-execute.ts — Wave 1 execution engine: autonomous categorization
//
// Penny works through the uncategorized bank-transaction backlog and CATEGORIZES
// the ones she's confident about — actually writing to Zoho Books via the Zoho
// MCP write tools. Anything ambiguous or material becomes a question in the CFO
// chat. Every action is recorded in the audit log for review/reversal.
//
// Modes:
//   LIVE      — Zoho Books MCP write tools are connected → Penny executes.
//   PROPOSE   — MCP not yet connected → Penny proposes what she WOULD do (safe
//               dry run over the real data), so you can watch it work first.
// The mode is auto-selected from whether the MCP is configured, and can be
// forced via the `dryRun` option.
// ---------------------------------------------------------------------------
import { callClaude, type McpServer } from "./anthropic";
import {
  fetchUncategorizedBankTxns,
  fetchChartOfAccounts,
  getZohoBooksMcpConfig,
  isMcpConfigured,
  type BooksBankTxn,
  type BooksAccount,
} from "./zoho-books";
import { renderPolicyBlock, addEscalations, type Escalation } from "./policy-ledger";
import { logActions, makeAction } from "./action-log";
import { WORKER_EXPERTISE } from "./accounting-knowledge";

// Transactions at or above this amount are ALWAYS escalated for a human eye,
// even when Penny is confident. Keeps big-dollar moves under review.
const MATERIALITY_THRESHOLD = 2500;

export interface CategorizationResult {
  mode: "executed" | "proposed";
  batchId: string;
  scanned: number;
  totalBacklog: number;
  executed: Array<{ transaction_id: string; summary: string; account: string; amount: number }>;
  escalated: Escalation[];
  remaining: number;
  report: string;
}

function parseResultObject(text: string): {
  executed?: Array<Record<string, unknown>>;
  escalated?: Array<Record<string, unknown>>;
} {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return {};
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1].trim());
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function mcpServers(): McpServer[] | undefined {
  const cfg = getZohoBooksMcpConfig();
  return cfg ? [cfg] : undefined;
}

const EXECUTION_SYSTEM_PROMPT = `${WORKER_EXPERTISE}

You are Penny Quill, Staff Accountant at Tilt Hockey Inc., running an AUTONOMOUS CATEGORIZATION pass over the uncategorized bank-transaction backlog.

AUTHORITY (Wave 1 — categorization only):
- You MAY categorize uncategorized bank transactions when you are confident, using ONLY the accounts in the provided Chart of Accounts.
- If the Zoho Books tools are available to you, USE them to actually categorize each confident transaction. If no tools are available, this is a DRY RUN — do not claim you wrote anything; just report what you WOULD do.
- You may ONLY categorize bank transactions in this pass. You must NOT create journal entries, write off invoices, merge vendors/accounts, change the Chart of Accounts, or touch anything in a prior closed period. If a transaction implies one of those, escalate it instead.

WHEN TO ACT vs ESCALATE:
- ACT (categorize) only when: an established policy covers it, OR the payee/description makes the correct account unambiguous — AND the amount is under $${MATERIALITY_THRESHOLD}.
- ESCALATE (ask Chris) when: you don't know who/what the transaction is, more than one account is plausible, it looks like a transfer/owner draw/loan, OR the amount is $${MATERIALITY_THRESHOLD} or more (even if you think you know). Better to ask than to miscategorize.

Return your work as a fenced json object (and nothing after it):
\`\`\`json
{
  "executed": [
    { "transaction_id": "...", "amount": 0, "account": "Account Name (code)", "basis": "policy name / why it's unambiguous", "summary": "Categorized $X from PAYEE → ACCOUNT" }
  ],
  "escalated": [
    { "transaction_id": "...", "amount": 0, "question": "plain-English question for Chris (who is this / how should we treat it)", "recommendation": "your best guess", "options": ["A", "B"] }
  ]
}
\`\`\`
In DRY RUN, "executed" means "would categorize as". Be conservative — a smaller number of correct categorizations plus honest escalations beats guessing.`;

/**
 * Run one categorization batch/chunk. Designed to be called repeatedly (e.g.
 * from a cron) to work through the whole backlog a chunk at a time, staying
 * within serverless time limits.
 */
export async function runCategorizationBatch(opts?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<CategorizationResult> {
  const limit = opts?.limit ?? 15;
  const live = opts?.dryRun === undefined ? isMcpConfigured() : !opts.dryRun;
  const batchId = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

  // Pull a chunk of the real uncategorized backlog + the valid categories.
  const [uncategorized, accounts] = await Promise.all([
    fetchUncategorizedBankTxns(limit),
    fetchChartOfAccounts().catch(() => [] as BooksAccount[]),
  ]);

  if (uncategorized.items.length === 0) {
    return {
      mode: live ? "executed" : "proposed",
      batchId,
      scanned: 0,
      totalBacklog: uncategorized.total,
      executed: [],
      escalated: [],
      remaining: uncategorized.total,
      report: "No uncategorized bank transactions found — nothing to do.",
    };
  }

  const txnBlock = uncategorized.items
    .map(
      (t: BooksBankTxn) =>
        `- id=${t.transaction_id} | ${t.date} | $${(t.amount ?? 0).toFixed(2)} | ${t.payee ?? "—"} | ${(t.description ?? "").slice(0, 80)} | acct=${t.account_name ?? "?"}`
    )
    .join("\n");

  const coaBlock = accounts
    .slice(0, 200)
    .map((a) => `- ${a.account_name} [${a.account_type}]`)
    .join("\n");

  const userMessage = [
    live
      ? "LIVE MODE: the Zoho Books tools are connected. Categorize each confident transaction using the tools. This writes to the real books."
      : "DRY RUN: no write tools are connected. Do NOT claim to have written anything — report what you WOULD categorize.",
    "",
    await renderPolicyBlock(),
    "",
    "## Chart of Accounts (valid categories)",
    coaBlock || "(unavailable)",
    "",
    `## Uncategorized Transactions to process (${uncategorized.items.length} of ${uncategorized.total} total)`,
    txnBlock,
  ].join("\n");

  const res = await callClaude({
    systemPrompt: EXECUTION_SYSTEM_PROMPT,
    userMessage,
    model: "claude-sonnet-4-6",
    maxTokens: 6000,
    temperature: 0,
    mcpServers: live ? mcpServers() : undefined,
  });

  const parsed = parseResultObject(res.text);
  const executedRaw = Array.isArray(parsed.executed) ? parsed.executed : [];
  const escalatedRaw = Array.isArray(parsed.escalated) ? parsed.escalated : [];

  // Record every action in the audit log.
  await logActions(
    executedRaw.map((e, i) =>
      makeAction({
        type: "categorize-transaction",
        mode: live ? "executed" : "proposed",
        targetId: String(e.transaction_id ?? ""),
        summary: String(e.summary ?? `Categorized as ${e.account ?? "?"}`),
        after: { account: e.account, basis: e.basis, amount: e.amount },
        batchId,
        index: i,
      })
    )
  );

  // Route the unknowns to the CFO chat / digest.
  const newEscalations = await addEscalations(
    escalatedRaw
      .map((e) => ({
        question: String(e.question ?? "").trim(),
        reason: `Uncategorized transaction ${e.transaction_id ?? ""} ($${e.amount ?? "?"}) — Penny needs to know how to treat it`,
        recommendation: e.recommendation ? String(e.recommendation) : undefined,
        dollarAmount: typeof e.amount === "number" ? e.amount : undefined,
      }))
      .filter((e) => e.question.length > 0)
  );

  const executed = executedRaw.map((e) => ({
    transaction_id: String(e.transaction_id ?? ""),
    summary: String(e.summary ?? ""),
    account: String(e.account ?? ""),
    amount: typeof e.amount === "number" ? e.amount : 0,
  }));

  const remaining = Math.max(0, uncategorized.total - executed.length);

  const report = [
    `# Categorization ${live ? "Run" : "Dry Run"} — ${batchId}`,
    "",
    live
      ? `✅ Executed **${executed.length}** categorizations in Zoho Books.`
      : `📝 Proposed **${executed.length}** categorizations (dry run — nothing written).`,
    `❓ Escalated **${newEscalations.length}** to your CFO chat.`,
    `📦 Backlog: ~${uncategorized.total} total, ~${remaining} remaining after this batch.`,
    "",
    executed.length > 0 ? "## Categorized" : "",
    ...executed.map((e) => `- ${e.summary || `${e.transaction_id} → ${e.account}`}`),
    "",
    newEscalations.length > 0 ? "## Needs your input (now in Talk to Sterling)" : "",
    ...newEscalations.map((e) => `- ${e.question}`),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    mode: live ? "executed" : "proposed",
    batchId,
    scanned: uncategorized.items.length,
    totalBacklog: uncategorized.total,
    executed,
    escalated: newEscalations,
    remaining,
    report,
  };
}
