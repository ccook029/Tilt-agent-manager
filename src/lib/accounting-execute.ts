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
  fetchTaxes,
  categorizeTxnAsExpense,
  categorizeTxnAsDeposit,
  txnDirection,
  type BooksBankTxn,
  type BooksAccount,
  type ZohoTax,
} from "./zoho-books";
import { renderPolicyBlock, addEscalations, type Escalation } from "./policy-ledger";
import { getActions, logActions, makeAction } from "./action-log";
import { recordProgress } from "./progress";
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

// Zoho only accepts certain account types on each side of a categorization.
// Validating here (instead of letting the write 404 with "enter valid expense
// account") turns a cryptic API error into a clear skip reason.
const EXPENSE_ACCOUNT_TYPES = new Set([
  "expense",
  "other_expense",
  "cost_of_goods_sold",
  "fixed_asset",
  "other_current_asset",
  "other_asset",
]);
const DEPOSIT_ACCOUNT_TYPES = new Set(["income", "other_income", "equity"]);

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

SALES TAX (HST) — you can post tax splits yourself now:
- When the amount INCLUDES sales tax (a tax-inclusive stick sale, an expense with HST), set "tax" to the EXACT tax name from the TAX CODES list. The system posts it TAX-INCLUSIVE and Zoho itself splits the amount — net to your account, tax to Tax Payable (sales) or the recoverable ITC (purchases). Do NOT escalate a transaction just because it needs an income/tax or expense/ITC split — that's what "tax" is for, and it replaces any manual journal entry.
- A tax-inclusive money-IN sale posts as a "sale without invoice" against the income account; a plain deposit (no tax) posts as a deposit. Money-OUT with tax posts as a tax-inclusive expense.
- Leave "tax" out entirely when no sales tax applies (transfers you were told to post, tax-exempt lines, reimbursements policy says are flat).

ACCOUNT TYPES (hard rule): a MONEY OUT line must go to an expense-type account (expense / other expense / COGS / an asset purchase). A MONEY IN line must go to income / other income / equity. Anything else (posting money-out to a liability, money-in to a bank account) will be rejected — those situations are transfers or payments, so escalate them instead.

Return ONLY your work as a fenced json object (nothing after it):
\`\`\`json
{
  "categorize": [
    { "transaction_id": "exact id from the list", "account": "exact account name from the Chart of Accounts", "tax": "exact tax name from TAX CODES — ONLY when the amount includes sales tax; omit otherwise", "basis": "policy name / why it's unambiguous", "summary": "Categorize $X PAYEE → ACCOUNT (+ tax)" }
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
  const [uncategorized, accounts, taxes, interac] = await Promise.all([
    fetchUncategorizedBankTxns(limit),
    fetchChartOfAccounts().catch(() => [] as BooksAccount[]),
    fetchTaxes().catch(() => [] as ZohoTax[]),
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
  const taxByName = new Map<string, ZohoTax>(
    taxes.map((t) => [t.tax_name.trim().toLowerCase(), t])
  );

  // Deterministic pre-match: for each bank line, find the Interac email with the
  // same amount within ±5 days AND the same money direction (a MONEY IN line
  // pairs with a "received" notification; a MONEY OUT line with a "sent" one —
  // e.g. an e-Transfer to a supplier for fuel). A unique hit is annotated right
  // on the transaction, carrying the counterparty name AND the sender's memo
  // ("Jer fuel - Jan.07"), which is often the whole answer to the category.
  const emailMatchFor = (t: BooksBankTxn): InteracNotification | null => {
    if (interac.length === 0) return null;
    const dir = txnDirection(t);
    const wantDir =
      dir === "in" ? "received" : dir === "out" ? "sent" : null;
    if (!wantDir) return null;
    const txnTime = new Date(t.date).getTime();
    const hits = interac.filter(
      (n) =>
        n.direction === wantDir &&
        n.amount != null &&
        Math.abs(n.amount - (t.amount ?? 0)) < 0.005 &&
        n.date &&
        Math.abs(new Date(n.date).getTime() - txnTime) <= 5 * 86_400_000
    );
    return hits.length === 1 ? hits[0] : null;
  };

  const txnBlock = uncategorized.items
    .map((t) => {
      const dir = txnDirection(t);
      const match = emailMatchFor(t);
      const counterparty = match
        ? `${match.direction === "sent" ? "to" : "from"} "${match.name ?? "?"}"`
        : "";
      const matchNote = match
        ? ` | EMAIL MATCH: ${counterparty}${match.message ? ` — message: "${match.message}"` : ""}`
        : "";
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
    "## TAX CODES (the ONLY valid values for \"tax\")",
    taxes.length > 0
      ? taxes.map((t) => `- ${t.tax_name} (${t.tax_percentage}%)`).join("\n")
      : "(no tax codes configured — leave \"tax\" out everywhere)",
    "",
    ...(interac.length > 0 ? [renderInteracBlock(interac), ""] : []),
    `## Uncategorized Transactions to process (${uncategorized.items.length} of ~${uncategorized.total} total)`,
    "Lines marked EMAIL MATCH were deterministically matched to an Interac e-Transfer notification by amount + date + direction. Treat the matched name as the payee/payer, and treat the matched message memo (e.g. \"Jer fuel\", \"stick payment\") as a STRONG hint for the category — it's the counterparty's own description of what the money was for. If a memo makes the category obvious, use it and don't escalate.",
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
    const taxName = String(d.tax ?? "").trim();
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
    // Zoho rejects type-incompatible accounts with a cryptic 404 ("enter valid
    // expense account") — catch it here with a reason a human can act on.
    const acctType = String(account.account_type ?? "").toLowerCase();
    if (direction === "out" && !EXPENSE_ACCOUNT_TYPES.has(acctType)) {
      skipped.push({
        transaction_id: txnId,
        reason: `"${account.account_name}" is ${acctType || "unknown type"} — not a valid expense account for a money-out line (transfers/payments should be escalated)`,
      });
      continue;
    }
    if (direction === "in" && !DEPOSIT_ACCOUNT_TYPES.has(acctType)) {
      skipped.push({
        transaction_id: txnId,
        reason: `"${account.account_name}" is ${acctType || "unknown type"} — money-in must go to income/other income/equity (transfers should be escalated)`,
      });
      continue;
    }
    // Tax code (optional): must exactly match a configured Zoho tax.
    let tax: ZohoTax | undefined;
    if (taxName && taxName.toLowerCase() !== "null" && taxName.toLowerCase() !== "none") {
      tax = taxByName.get(taxName.toLowerCase());
      if (!tax) {
        skipped.push({
          transaction_id: txnId,
          reason: `tax "${taxName}" not found in Zoho's configured taxes`,
        });
        continue;
      }
    }

    const summary =
      String(d.summary ?? "") ||
      `Categorize $${(txn.amount ?? 0).toFixed(2)} ${direction === "in" ? "in" : "out"} ${txn.payee ?? txn.description ?? ""} → ${account.account_name}${tax ? ` (${tax.tax_name} inclusive)` : ""}`;

    if (live) {
      try {
        if (direction === "in") {
          await categorizeTxnAsDeposit(txnId, {
            from_account_id: account.account_id,
            to_account_id: txn.account_id,
            date: txn.date,
            amount: txn.amount,
            description: txn.description,
            // A taxed money-in is a sale — Zoho splits revenue vs tax payable.
            ...(tax
              ? {
                  transaction_type: "sales_without_invoices" as const,
                  tax_id: tax.tax_id,
                  is_inclusive_tax: true,
                }
              : {}),
          });
        } else {
          await categorizeTxnAsExpense(txnId, {
            account_id: account.account_id,
            paid_through_account_id: txn.account_id,
            date: txn.date,
            amount: txn.amount,
            description: txn.description,
            // A taxed money-out splits net expense vs recoverable ITC in Zoho.
            ...(tax ? { tax_id: tax.tax_id, is_inclusive_tax: true } : {}),
          });
        }
      } catch (err) {
        skipped.push({
          transaction_id: txnId,
          reason: `Zoho write failed (account "${account.account_name}"${tax ? `, tax ${tax.tax_name}` : ""}): ${err instanceof Error ? err.message : String(err)}`,
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

  // Track the backlog burning down for the dashboard tile + Morning Brief.
  if (live) {
    await recordProgress({
      at: new Date().toISOString(),
      uncategorized: remaining,
      written: executed.length,
    }).catch(() => {});
  }

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
