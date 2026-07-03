import { CLAUDE_MODEL } from "@/lib/models";
// ---------------------------------------------------------------------------
// accounting-execute.ts — Wave 1 execution engine: autonomous categorization
//
// Penny works through the uncategorized bank-transaction backlog. SHE DECIDES,
// THE CODE EXECUTES: she returns structured categorization decisions, and this
// module validates each one against hard guardrails and performs the actual
// Zoho Books write deterministically. That split matters — the model never
// touches the API directly, so a hallucinated account or id can't reach the
// books.
//
// Guardrails (code-enforced, not just prompted):
//   - Only transactions from the fetched uncategorized list (by exact id).
//   - The target account must exactly match the Chart of Accounts.
//   - Amounts >= $2,500 are never auto-written — they escalate to Chris.
//   - The FIRST live batch is capped at 5 so Chris can verify in Zoho before
//     the engine scales to the full backlog.
//   - Every write is logged (before/after) and reversible via uncategorize.
//
// Modes: LIVE (default — writes to Zoho Books) or DRY RUN (dryRun:true —
// reports what it would do, writes nothing).
// ---------------------------------------------------------------------------
import { callClaude } from "./anthropic";
import {
  fetchUncategorizedBankTxns,
  fetchChartOfAccounts,
  categorizeTxnAsExpense,
  categorizeTxnAsDeposit,
  txnDirection,
  type BooksBankTxn,
  type BooksAccount,
} from "./zoho-books";
import { renderPolicyBlock, addEscalations, type Escalation } from "./policy-ledger";
import { getActions, logActions, makeAction } from "./action-log";
import { WORKER_EXPERTISE } from "./accounting-knowledge";
import {
  isInboxConfigured,
  fetchInteracNotifications,
  renderInteracBlock,
  type InteracNotification,
} from "./email-inbox";

// Transactions at or above this amount are ALWAYS escalated for a human eye,
// even when Penny is confident. Keeps big-dollar moves under review.
const MATERIALITY_THRESHOLD = 2500;

// The first live batch is small on purpose: verify a handful in Zoho Books,
// then subsequent runs use the full batch size.
const FIRST_LIVE_BATCH_CAP = 5;

export interface CategorizationResult {
  mode: "executed" | "proposed";
  batchId: string;
  scanned: number;
  totalBacklog: number;
  executed: Array<{ transaction_id: string; summary: string; account: string; amount: number }>;
  skipped: Array<{ transaction_id: string; reason: string }>;
  escalated: Escalation[];
  remaining: number;
  report: string;
}

function parseResultObject(text: string): {
  categorize?: Array<Record<string, unknown>>;
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

const EXECUTION_SYSTEM_PROMPT = `${WORKER_EXPERTISE}

You are Penny Quill, Staff Accountant at Tilt Hockey Inc., running an AUTONOMOUS CATEGORIZATION pass over the uncategorized bank-transaction backlog.

HOW THIS WORKS: You DECIDE the categorization for each transaction; the system validates and performs the actual write to Zoho Books. Your decisions are only applied when they pass hard validation (known transaction id, account exactly matching the Chart of Accounts, amount under $${MATERIALITY_THRESHOLD}). So precision matters: use ids and account names EXACTLY as given.

WHEN TO CATEGORIZE vs ESCALATE:
- CATEGORIZE only when: an established policy covers it, OR the payee/description makes the correct account unambiguous — AND the amount is under $${MATERIALITY_THRESHOLD}.
- ESCALATE (ask Chris) when: you don't know who/what the transaction is, more than one account is plausible, it looks like a transfer between Tilt accounts / an owner draw / a loan movement (these are NOT expenses or income), OR the amount is $${MATERIALITY_THRESHOLD}+ even if you're confident.
- Money-in lines are revenue ONLY if you're sure — unknown e-Transfers/deposits could be transfers or owner contributions. When unsure, escalate.

Return ONLY your work as a fenced json object (nothing after it):
\`\`\`json
{
  "categorize": [
    { "transaction_id": "exact id from the list", "account": "exact account name from the Chart of Accounts", "basis": "policy name / why it's unambiguous", "summary": "Categorize $X PAYEE → ACCOUNT" }
  ],
  "escalated": [
    { "transaction_id": "exact id", "amount": 0, "question": "plain-English question for Chris (who is this / how should we treat it)", "recommendation": "your best guess", "options": ["A", "B"] }
  ]
}
\`\`\`
Be conservative — a smaller number of correct categorizations plus honest escalations beats guessing.`;

/**
 * Run one categorization batch/chunk. Designed to be called repeatedly (cron,
 * chat dispatch, or the dashboard button) to work through the whole backlog a
 * chunk at a time, staying within serverless time limits.
 */
export async function runCategorizationBatch(opts?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<CategorizationResult> {
  const live = opts?.dryRun !== true;
  let limit = opts?.limit ?? 15;
  const batchId = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

  // First-live-batch safety cap: until at least one executed write exists in
  // the audit log, keep the batch tiny so Chris can verify in Zoho first.
  let firstLiveRun = false;
  if (live) {
    const prior = await getActions();
    firstLiveRun = !prior.some((a) => a.mode === "executed");
    if (firstLiveRun) limit = Math.min(limit, FIRST_LIVE_BATCH_CAP);
  }

  // Pull a chunk of the real uncategorized backlog + the valid categories +
  // (when the inbox is connected) Interac notification emails, which carry the
  // sender names the bank feed strips off e-Transfers.
  const [uncategorized, accounts, interac] = await Promise.all([
    fetchUncategorizedBankTxns(limit),
    fetchChartOfAccounts().catch(() => [] as BooksAccount[]),
    isInboxConfigured()
      ? fetchInteracNotifications().catch((e) => {
          console.warn("[accounting-execute] Inbox pull failed:", e);
          return [] as InteracNotification[];
        })
      : Promise.resolve([] as InteracNotification[]),
  ]);

  if (uncategorized.items.length === 0) {
    return {
      mode: live ? "executed" : "proposed",
      batchId,
      scanned: 0,
      totalBacklog: uncategorized.total,
      executed: [],
      skipped: [],
      escalated: [],
      remaining: uncategorized.total,
      report: "No uncategorized bank transactions found — the backlog is clear. 🎉",
    };
  }

  const txnById = new Map<string, BooksBankTxn>(
    uncategorized.items.map((t) => [String(t.transaction_id), t])
  );
  const accountByName = new Map<string, BooksAccount>(
    accounts.map((a) => [a.account_name.trim().toLowerCase(), a])
  );

  // Deterministic pre-match: for each money-in line, find the Interac email
  // with the same amount within ±5 days. A unique hit is annotated directly on
  // the transaction so Penny doesn't have to hunt for it.
  const emailMatchFor = (t: BooksBankTxn): InteracNotification | null => {
    if (txnDirection(t) !== "in" || interac.length === 0) return null;
    const txnTime = new Date(t.date).getTime();
    const hits = interac.filter(
      (n) =>
        n.direction === "received" &&
        n.amount != null &&
        Math.abs(n.amount - (t.amount ?? 0)) < 0.005 &&
        n.date &&
        Math.abs(new Date(n.date).getTime() - txnTime) <= 5 * 86_400_000
    );
    return hits.length === 1 ? hits[0] : null;
  };

  const txnBlock = uncategorized.items
    .map((t) => {
      const match = emailMatchFor(t);
      const matchNote = match
        ? ` | EMAIL MATCH: from "${match.name ?? "?"}"${match.message ? ` — message: "${match.message}"` : ""}`
        : "";
      const dir = txnDirection(t);
      const dirLabel =
        dir === "in" ? "MONEY IN" : dir === "out" ? "MONEY OUT" : "DIRECTION UNKNOWN — do not categorize; escalate";
      return `- id=${t.transaction_id} | ${t.date} | $${(t.amount ?? 0).toFixed(2)} | ${dirLabel} | ${t.payee ?? "—"} | ${(t.description ?? "").slice(0, 80)} | bank=${t.account_name ?? "?"}${matchNote}`;
    })
    .join("\n");

  const coaBlock = accounts
    .slice(0, 200)
    .map((a) => `- ${a.account_name} [${a.account_type}]`)
    .join("\n");

  const userMessage = [
    live
      ? "LIVE MODE: validated decisions will be written to the real books (and are reversible)."
      : "DRY RUN: nothing will be written — decide exactly as if it were live.",
    "",
    await renderPolicyBlock(),
    "",
    "## Chart of Accounts (the ONLY valid category names)",
    coaBlock || "(unavailable)",
    "",
    ...(interac.length > 0 ? [renderInteracBlock(interac), ""] : []),
    `## Uncategorized Transactions to process (${uncategorized.items.length} of ~${uncategorized.total} total)`,
    "Lines marked EMAIL MATCH have been deterministically matched to an Interac notification by amount + date — treat the matched name/message as the payee.",
    txnBlock,
  ].join("\n");

  const res = await callClaude({
    systemPrompt: EXECUTION_SYSTEM_PROMPT,
    userMessage,
    model: CLAUDE_MODEL,
    maxTokens: 6000,
    temperature: 0,
  });

  const parsed = parseResultObject(res.text);
  const decisions = Array.isArray(parsed.categorize) ? parsed.categorize : [];
  const escalatedRaw = Array.isArray(parsed.escalated) ? parsed.escalated : [];

  // ---- Validate + execute each decision (code-enforced guardrails) --------
  const executed: CategorizationResult["executed"] = [];
  const skipped: CategorizationResult["skipped"] = [];

  for (const d of decisions) {
    const txnId = String(d.transaction_id ?? "");
    const accountName = String(d.account ?? "").trim();
    const txn = txnById.get(txnId);
    const account = accountByName.get(accountName.toLowerCase());

    if (!txn) {
      skipped.push({ transaction_id: txnId, reason: "unknown transaction id (not in this batch)" });
      continue;
    }
    if (!account) {
      skipped.push({ transaction_id: txnId, reason: `account "${accountName}" not found in Chart of Accounts` });
      continue;
    }
    if ((txn.amount ?? 0) >= MATERIALITY_THRESHOLD) {
      skipped.push({ transaction_id: txnId, reason: `$${txn.amount} is at/above the $${MATERIALITY_THRESHOLD} materiality gate` });
      continue;
    }
    if (!txn.account_id) {
      skipped.push({ transaction_id: txnId, reason: "missing bank account id on the feed line" });
      continue;
    }
    const direction = txnDirection(txn);
    if (direction === "unknown") {
      // Never guess deposit-vs-expense — a wrong guess writes the wrong entry.
      skipped.push({
        transaction_id: txnId,
        reason: "money direction could not be determined (no debit/credit flag, type, or memo wording) — needs a human look",
      });
      continue;
    }

    const summary =
      String(d.summary ?? "") ||
      `Categorize $${(txn.amount ?? 0).toFixed(2)} ${direction === "in" ? "in" : "out"} ${txn.payee ?? txn.description ?? ""} → ${account.account_name}`;

    if (live) {
      try {
        if (direction === "in") {
          await categorizeTxnAsDeposit(txnId, {
            from_account_id: account.account_id,
            to_account_id: txn.account_id,
            date: txn.date,
            amount: txn.amount,
            description: txn.description,
          });
        } else {
          await categorizeTxnAsExpense(txnId, {
            account_id: account.account_id,
            paid_through_account_id: txn.account_id,
            date: txn.date,
            amount: txn.amount,
            description: txn.description,
          });
        }
      } catch (err) {
        skipped.push({
          transaction_id: txnId,
          reason: `Zoho write failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
    }

    executed.push({
      transaction_id: txnId,
      summary,
      account: account.account_name,
      amount: txn.amount ?? 0,
    });
  }

  // ---- Audit log -----------------------------------------------------------
  await logActions([
    ...executed.map((e, i) =>
      makeAction({
        type: "categorize-transaction",
        mode: live ? "executed" : "proposed",
        targetId: e.transaction_id,
        summary: e.summary,
        before: { status: "uncategorized" },
        after: { account: e.account, amount: e.amount },
        batchId,
        index: i,
      })
    ),
    ...skipped.map((s, i) =>
      makeAction({
        type: "categorize-transaction",
        mode: "proposed",
        targetId: s.transaction_id,
        summary: `SKIPPED: ${s.reason}`,
        batchId,
        index: executed.length + i,
      })
    ),
  ]);

  // ---- Route the unknowns to the CFO chat / digest --------------------------
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

  const remaining = Math.max(0, uncategorized.total - (live ? executed.length : 0));

  const report = [
    `# Categorization ${live ? "Run" : "Dry Run"} — ${batchId}`,
    "",
    live
      ? `✅ Wrote **${executed.length}** categorizations to Zoho Books.`
      : `📝 Proposed **${executed.length}** categorizations (dry run — nothing written).`,
    skipped.length > 0 ? `⏭️ Skipped **${skipped.length}** (failed a guardrail — see below).` : "",
    `❓ Escalated **${newEscalations.length}** to your CFO chat.`,
    `📦 Backlog: ~${uncategorized.total} total, ~${remaining} remaining.`,
    firstLiveRun
      ? `\n> 🔎 **First live batch — capped at ${FIRST_LIVE_BATCH_CAP}.** Open Zoho Books → Banking and verify these look right, then run again to process the rest at full speed.`
      : "",
    "",
    executed.length > 0 ? (live ? "## Written to the books" : "## Would categorize") : "",
    ...executed.map((e) => `- ${e.summary}`),
    "",
    skipped.length > 0 ? "## Skipped (guardrails)" : "",
    ...skipped.map((s) => `- ${s.transaction_id}: ${s.reason}`),
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
    skipped,
    escalated: newEscalations,
    remaining,
    report,
  };
}
