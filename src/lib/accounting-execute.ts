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
  fetchInvoiceByNumber,
  fetchOpenInvoices,
  fetchMatchCandidates,
  matchTxn,
  categorizeTxnAsExpense,
  categorizeTxnAsDeposit,
  categorizeTxnAsCustomerPayment,
  uncategorizeTxn,
  txnDirection,
  type BooksBankTxn,
  type BooksAccount,
  type ZohoTax,
} from "./zoho-books";
import { renderPolicyBlock, addEscalations, type Escalation } from "./policy-ledger";
import { getActions, logActions, makeAction, markActionReversed } from "./action-log";
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

interface ParsedResult {
  categorize?: Array<Record<string, unknown>>;
  apply_to_invoice?: Array<Record<string, unknown>>;
  escalated?: Array<Record<string, unknown>>;
}

/** Parse the model's decisions. `ok:false` means the response existed but no
 * decision object could be recovered (usually a truncated reply) — callers
 * MUST surface that loudly instead of reporting a quiet all-zero run. */
function parseResultObject(text: string): { data: ParsedResult; ok: boolean } {
  const tryParse = (s: string): ParsedResult | null => {
    try {
      const parsed = JSON.parse(s.trim());
      return typeof parsed === "object" && parsed ? (parsed as ParsedResult) : null;
    } catch {
      return null;
    }
  };
  // 1) Complete fenced block(s) — take the last.
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length > 0) {
    const parsed = tryParse(matches[matches.length - 1][1]);
    if (parsed) return { data: parsed, ok: true };
  }
  // 2) An unfenced or fence-truncated object: first "{" to the last "}".
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const parsed = tryParse(text.slice(first, last + 1));
    if (parsed) return { data: parsed, ok: true };
  }
  return { data: {}, ok: false };
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

MONEY DIRECTION: each line's MONEY IN / MONEY OUT label is the system's best read; a line with EMAIL MATCH has its direction CONFIRMED by the Interac notification (received = in, sent = out) — trust that over the raw label. Always include "direction" ("in" or "out") in each decision — your independent read from the payee/memo/policy. If your direction disagrees with the system's, the line is skipped for a human look rather than posted wrong; that's intended.

PAYMENTS ON EXISTING INVOICES: when a deposit pays an invoice Tilt already raised (a policy says "applied against INV-00xxx", or the memo/name clearly matches an open invoice), do NOT categorize it to an income account — that double-counts revenue. Put it in "apply_to_invoice" with the exact invoice number instead; the system applies it as a customer payment and clears A/R. Watch for payer≠customer: relatives often pay a player's invoice (a deposit from one surname may pay an invoice under another). The system also cross-checks every income posting against open invoices and holds suspicious matches for Chris.

Return ONLY your work as a fenced json object (nothing after it):
\`\`\`json
{
  "categorize": [
    { "transaction_id": "exact id from the list", "direction": "in|out — your independent read", "account": "exact account name from the Chart of Accounts", "tax": "exact tax name from TAX CODES — ONLY when the amount includes sales tax; omit otherwise", "basis": "policy name / why it's unambiguous", "summary": "Categorize $X PAYEE → ACCOUNT (+ tax)" }
  ],
  "apply_to_invoice": [
    { "transaction_id": "exact id", "invoice_number": "INV-00xxx", "basis": "policy / memo evidence this pays that invoice", "summary": "Apply $X from PAYER → INV-00xxx" }
  ],
  "escalated": [
    { "transaction_id": "exact id", "amount": 0, "question": "plain-English question for Chris (who is this / how should we treat it)", "recommendation": "your best guess", "options": ["A", "B"] }
  ]
}
\`\`\`
Be conservative — a smaller number of correct categorizations plus honest escalations beats guessing. Keep it COMPACT: no prose before or after the json; "basis" and "summary" under ~15 words each; escalation questions to the point. A response that runs long risks being cut off, which wastes the whole batch.`;

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

  // Prior writes: drive the first-live-batch cap AND the duplicate guard
  // (a same-amount/same-account line posted in the last two weeks is held for
  // confirmation instead of silently posted again).
  const prior = await getActions();
  let firstLiveRun = false;
  if (live) {
    firstLiveRun = !prior.some((a) => a.mode === "executed");
    if (firstLiveRun) limit = Math.min(limit, FIRST_LIVE_BATCH_CAP);
  }

  // Pull a chunk of the real uncategorized backlog + the valid categories +
  // (when the inbox is connected) Interac notification emails, which carry the
  // sender names the bank feed strips off e-Transfers.
  const [uncategorized, accounts, taxes, openInvoices, interac] = await Promise.all([
    fetchUncategorizedBankTxns(limit),
    fetchChartOfAccounts().catch(() => [] as BooksAccount[]),
    fetchTaxes().catch(() => [] as ZohoTax[]),
    fetchOpenInvoices().catch(() => []),
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
  // Forgiving tax lookup: exact name, then with a "(13%)"-style suffix
  // stripped (Penny once copied the display format verbatim), then a unique
  // containment match ("HST" ↔ "HST 13"). Null = genuinely unknown.
  const resolveTax = (raw: string): ZohoTax | null => {
    const name = raw.trim().toLowerCase();
    if (!name) return null;
    const exact = taxByName.get(name);
    if (exact) return exact;
    const stripped = name.replace(/\s*\(?\d+(\.\d+)?\s*%\)?\s*$/, "").trim();
    if (stripped && taxByName.get(stripped)) return taxByName.get(stripped)!;
    const contains = taxes.filter((t) => {
      const tn = t.tax_name.trim().toLowerCase();
      return tn.includes(stripped || name) || (stripped || name).includes(tn);
    });
    return contains.length === 1 ? contains[0] : null;
  };

  // Deterministic pre-match: for each bank line, find the Interac email with
  // the same amount within ±5 days. Matched DIRECTION-AGNOSTICALLY on purpose:
  // some feeds carry an inverted debit/credit flag (we saw Interac deposits
  // flagged as money-out in production), and a unique "received $210" email is
  // PROOF of money-in that beats the flag. The unique hit is annotated on the
  // transaction — counterparty name + the sender's own memo ("Jer fuel"), and
  // its direction becomes authoritative for validation and the write.
  const emailMatchFor = (t: BooksBankTxn): InteracNotification | null => {
    if (interac.length === 0) return null;
    const txnTime = new Date(t.date).getTime();
    const hits = interac.filter(
      (n) =>
        n.amount != null &&
        Math.abs(n.amount - (t.amount ?? 0)) < 0.005 &&
        n.date &&
        Math.abs(new Date(n.date).getTime() - txnTime) <= 5 * 86_400_000
    );
    return hits.length === 1 ? hits[0] : null;
  };

  /** Best-evidence direction: a unique email match trumps the feed's flag. */
  const effectiveDirection = (
    t: BooksBankTxn,
    match: InteracNotification | null
  ): "in" | "out" | "unknown" => {
    if (match?.direction === "received") return "in";
    if (match?.direction === "sent") return "out";
    return txnDirection(t);
  };

  const matchByTxnId = new Map<string, InteracNotification | null>(
    uncategorized.items.map((t) => [String(t.transaction_id), emailMatchFor(t)])
  );

  const txnBlock = uncategorized.items
    .map((t) => {
      const match = matchByTxnId.get(String(t.transaction_id)) ?? null;
      const dir = effectiveDirection(t, match);
      const counterparty = match
        ? `${match.direction === "sent" ? "to" : "from"} "${match.name ?? "?"}"`
        : "";
      const matchNote = match
        ? ` | EMAIL MATCH (direction confirmed): ${counterparty}${match.message ? ` — message: "${match.message}"` : ""}`
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
    "## TAX CODES (use the exact name inside the quotes as \"tax\")",
    taxes.length > 0
      ? taxes.map((t) => `- "${t.tax_name}" — ${t.tax_percentage}%`).join("\n")
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
    // Room for 15 decisions + escalations; a truncated reply here previously
    // parsed as "nothing to do" and produced a silent all-zero run.
    maxTokens: 12000,
    temperature: 0,
  });

  const { data: parsed, ok: parsedOk } = parseResultObject(res.text);
  if (!parsedOk && uncategorized.items.length > 0) {
    // The model replied but no decision object could be recovered — say so
    // LOUDLY instead of reporting a quiet "0 written, 0 escalated" run.
    console.error(
      `[accounting-execute] Unparseable decision response (${res.text.length} chars). Tail: ${res.text.slice(-300)}`
    );
    const report = [
      `# Categorization ${live ? "Run" : "Dry Run"} — ${batchId}`,
      "",
      "⚠️ **This run did nothing** — Penny's decision response couldn't be parsed (usually a cut-off reply), so no writes, no skips, no escalations.",
      `📦 Backlog: ~${uncategorized.total} total, unchanged.`,
      "",
      "Run it again — this is transient. If it happens repeatedly, that's a bug to flag.",
      "",
      `_Debug: response was ${res.text.length} chars; tail: “…${res.text.slice(-160).replace(/\n/g, " ")}”_`,
    ].join("\n");
    return {
      mode: live ? "executed" : "proposed",
      batchId,
      scanned: uncategorized.items.length,
      totalBacklog: uncategorized.total,
      executed: [],
      skipped: [],
      escalated: [],
      remaining: uncategorized.total,
      report,
    };
  }
  const decisions = Array.isArray(parsed.categorize) ? parsed.categorize : [];
  const invoiceApplications = Array.isArray(parsed.apply_to_invoice) ? parsed.apply_to_invoice : [];
  const escalatedRaw = Array.isArray(parsed.escalated) ? parsed.escalated : [];

  // ---- Validate + execute each decision (code-enforced guardrails) --------
  const executed: CategorizationResult["executed"] = [];
  const skipped: CategorizationResult["skipped"] = [];
  // Double-count guards: questions raised by the CODE (not the model) when a
  // write looks like it could count the same money twice. They flow into the
  // same escalation queue Chris already answers.
  const guardQuestions: Array<{
    question: string;
    reason: string;
    recommendation?: string;
    dollarAmount?: number;
  }> = [];
  // Amount+direction pairs written earlier in THIS batch (feed-duplicate guard).
  const writtenThisBatch = new Set<string>();
  const twoWeeksAgo = Date.now() - 14 * 86_400_000;
  const recentExecuted = prior.filter(
    (a) =>
      a.mode === "executed" &&
      !a.reversed &&
      a.type === "categorize-transaction" &&
      new Date(a.timestamp).getTime() >= twoWeeksAgo
  );

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
    const match = matchByTxnId.get(txnId) ?? null;
    let direction = effectiveDirection(txn, match);
    const pennyDirection = String(d.direction ?? "").trim().toLowerCase();
    if (direction === "unknown") {
      // No flag, no email evidence — accept Penny's stated read (she's
      // instructed to only state it when policy/memo makes it certain), and
      // the account-type gate below still has to agree with it.
      if (pennyDirection === "in" || pennyDirection === "out") {
        direction = pennyDirection;
      } else {
        skipped.push({
          transaction_id: txnId,
          reason: "money direction could not be determined (no debit/credit flag, type, or memo wording) — needs a human look",
        });
        continue;
      }
    } else if (
      (pennyDirection === "in" || pennyDirection === "out") &&
      pennyDirection !== direction &&
      !match
    ) {
      // Penny disagrees with the feed's flag and there's no email evidence to
      // break the tie — don't post either version, surface it.
      skipped.push({
        transaction_id: txnId,
        reason: `direction conflict: feed says ${direction.toUpperCase()}, Penny says ${pennyDirection.toUpperCase()} — needs a human look`,
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
    // Tax code (optional): resolved forgivingly against the configured taxes.
    let tax: ZohoTax | undefined;
    if (taxName && taxName.toLowerCase() !== "null" && taxName.toLowerCase() !== "none") {
      const resolved = resolveTax(taxName);
      if (!resolved) {
        skipped.push({
          transaction_id: txnId,
          reason: `tax "${taxName}" not found in Zoho's configured taxes (${taxes.map((t) => t.tax_name).join(", ") || "none configured"})`,
        });
        continue;
      }
      tax = resolved;
    }

    const amt = txn.amount ?? 0;
    const who = txn.payee ?? match?.name ?? txn.description?.slice(0, 40) ?? "unknown payer";

    // GUARD 1 — deposit matches an open invoice: posting it as fresh income
    // would double-count revenue already recognized when the invoice was
    // raised (e.g. a family member paying someone else's invoice, so the
    // payer name doesn't match the customer). Hold it and ask.
    if (direction === "in") {
      const invHit = openInvoices.find(
        (i) => Math.abs(i.balance - amt) < 0.01 || Math.abs(i.total - amt) < 0.01
      );
      if (invHit) {
        skipped.push({
          transaction_id: txnId,
          reason: `$${amt.toFixed(2)} matches open invoice ${invHit.invoice_number} (${invHit.customer_name}) — held so revenue isn't double-counted; question raised`,
        });
        guardQuestions.push({
          question: `The $${amt.toFixed(2)} deposit on ${txn.date} (${who}) matches open invoice ${invHit.invoice_number} for ${invHit.customer_name} — is it the payment on that invoice (payer may differ from the customer), or a separate new sale?`,
          reason: `Posting it as new income would double-count revenue if ${invHit.invoice_number} covers it`,
          recommendation: `Apply it to ${invHit.invoice_number} — if you confirm, Penny will apply it next batch`,
          dollarAmount: amt,
        });
        continue;
      }
    }

    // GUARD 2 — same amount+direction already written earlier in THIS batch:
    // either a genuinely repeated charge or the bank feed imported the same
    // line twice. Post the first, hold the rest and ask.
    const dupKey = `${direction}|${amt.toFixed(2)}`;
    if (writtenThisBatch.has(dupKey)) {
      skipped.push({
        transaction_id: txnId,
        reason: `another $${amt.toFixed(2)} ${direction === "in" ? "money-in" : "money-out"} line was already posted in this batch — held as a possible duplicate feed line; question raised`,
      });
      guardQuestions.push({
        question: `Two bank lines in the same batch are each $${amt.toFixed(2)} ${direction === "in" ? "in" : "out"} (latest: ${txn.date}, ${who}) — are they separate real charges, or did the bank feed import the same one twice?`,
        reason: "Identical amounts in one batch can be a duplicated feed line — posting both would double-count",
        recommendation: "If it's a duplicate, exclude the extra line in Zoho Banking; if both are real, say so and Penny will post it next batch",
        dollarAmount: amt,
      });
      continue;
    }

    // GUARD 3 — same amount+account executed in the last 14 days: hold repeat
    // postings (recurring charges are fine — one confirmation clears them).
    const histHit = recentExecuted.find((a) => {
      const prevAmt = Number((a.after as { amount?: unknown } | undefined)?.amount ?? NaN);
      const prevAcct = String((a.after as { account?: unknown } | undefined)?.account ?? "");
      return Math.abs(prevAmt - amt) < 0.005 && prevAcct === account.account_name;
    });
    if (histHit) {
      skipped.push({
        transaction_id: txnId,
        reason: `$${amt.toFixed(2)} → ${account.account_name} was already posted on ${histHit.timestamp.slice(0, 10)} — held as a possible duplicate; question raised`,
      });
      guardQuestions.push({
        question: `A $${amt.toFixed(2)} line (${txn.date}, ${who}) is headed to ${account.account_name}, but an identical amount was posted there on ${histHit.timestamp.slice(0, 10)} ("${histHit.summary.slice(0, 80)}") — is this a separate real charge?`,
        reason: "Same amount to the same account within two weeks can be a duplicate bank line",
        recommendation: "If both are real (e.g. repeat fuel e-Transfers), confirm and Penny will post it next batch; if it's a duplicate, exclude it in Zoho Banking",
        dollarAmount: amt,
      });
      continue;
    }

    const summary =
      String(d.summary ?? "") ||
      `Categorize $${amt.toFixed(2)} ${direction === "in" ? "in" : "out"} ${txn.payee ?? txn.description ?? ""} → ${account.account_name}${tax ? ` (${tax.tax_name} inclusive)` : ""}`;

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

    writtenThisBatch.add(dupKey);
    executed.push({
      transaction_id: txnId,
      summary,
      account: account.account_name,
      amount: txn.amount ?? 0,
    });
  }

  // ---- Apply deposits to existing invoices (clears A/R, no double-count) ---
  for (const a of invoiceApplications) {
    const txnId = String(a.transaction_id ?? "");
    const invoiceNumber = String(a.invoice_number ?? "").trim();
    const txn = txnById.get(txnId);
    if (!txn) {
      skipped.push({ transaction_id: txnId, reason: "unknown transaction id (not in this batch)" });
      continue;
    }
    if (!invoiceNumber) {
      skipped.push({ transaction_id: txnId, reason: "apply_to_invoice without an invoice number" });
      continue;
    }
    if (!txn.account_id) {
      skipped.push({ transaction_id: txnId, reason: "missing bank account id on the feed line" });
      continue;
    }
    const match = matchByTxnId.get(txnId) ?? null;
    const direction = effectiveDirection(txn, match);
    if (direction === "out") {
      skipped.push({
        transaction_id: txnId,
        reason: `can't apply a money-out line to ${invoiceNumber} — invoice payments are deposits`,
      });
      continue;
    }
    if ((txn.amount ?? 0) >= MATERIALITY_THRESHOLD) {
      skipped.push({ transaction_id: txnId, reason: `$${txn.amount} is at/above the $${MATERIALITY_THRESHOLD} materiality gate` });
      continue;
    }
    const invoice = await fetchInvoiceByNumber(invoiceNumber).catch(() => null);
    if (!invoice) {
      skipped.push({ transaction_id: txnId, reason: `invoice ${invoiceNumber} not found in Zoho Books` });
      continue;
    }
    if (!invoice.customer_id) {
      skipped.push({ transaction_id: txnId, reason: `invoice ${invoiceNumber} has no customer id on the API record` });
      continue;
    }
    if ((txn.amount ?? 0) > invoice.balance + 0.01) {
      // The invoice is already (fully or partly) paid — this feed line most
      // likely duplicates a payment that's ALREADY recorded in Books. The
      // right reconciliation is a MATCH to that existing transaction, not a
      // new posting. Ask Zoho for its own match candidates; a unique
      // same-amount hit is safe to take automatically.
      const candidates = await fetchMatchCandidates(txnId).catch(() => []);
      const sameAmount = candidates.filter(
        (c) => c.amount == null || Math.abs((c.amount ?? 0) - (txn.amount ?? 0)) < 0.005
      );
      if (live && sameAmount.length === 1) {
        try {
          await matchTxn(txnId, sameAmount);
          executed.push({
            transaction_id: txnId,
            summary: `Matched $${(txn.amount ?? 0).toFixed(2)} to the already-recorded ${sameAmount[0].transaction_type.replace(/_/g, " ")} (${invoiceNumber} was already paid) — line reconciled, nothing double-posted`,
            account: `matched — ${invoiceNumber}`,
            amount: txn.amount ?? 0,
          });
          continue;
        } catch (err) {
          skipped.push({
            transaction_id: txnId,
            reason: `${invoiceNumber} is already paid; auto-match failed (${err instanceof Error ? err.message : String(err)}) — match or exclude this line in Zoho Banking`,
          });
          continue;
        }
      }
      skipped.push({
        transaction_id: txnId,
        reason: `${invoiceNumber} is already fully paid (balance $${invoice.balance.toFixed(2)}) — this line likely duplicates a recorded payment; ${sameAmount.length} match candidate${sameAmount.length === 1 ? "" : "s"} found, match or exclude it in Zoho Banking`,
      });
      continue;
    }

    const summary =
      String(a.summary ?? "") ||
      `Apply $${(txn.amount ?? 0).toFixed(2)} from ${match?.name ?? txn.payee ?? "deposit"} → ${invoiceNumber} (${invoice.customer_name})`;

    if (live) {
      try {
        await categorizeTxnAsCustomerPayment(txnId, {
          customer_id: invoice.customer_id,
          invoice_id: invoice.invoice_id,
          amount: txn.amount ?? 0,
          date: txn.date,
          account_id: txn.account_id,
          description: txn.description,
        });
      } catch (err) {
        skipped.push({
          transaction_id: txnId,
          reason: `Zoho write failed (payment on ${invoiceNumber}): ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
    }
    executed.push({
      transaction_id: txnId,
      summary,
      account: `A/R — ${invoiceNumber}`,
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

  // ---- Route the unknowns + guard holds to the CFO chat / digest -----------
  const newEscalations = await addEscalations([
    ...escalatedRaw
      .map((e) => ({
        question: String(e.question ?? "").trim(),
        reason: `Uncategorized transaction ${e.transaction_id ?? ""} ($${e.amount ?? "?"}) — Penny needs to know how to treat it`,
        recommendation: e.recommendation ? String(e.recommendation) : undefined,
        dollarAmount: typeof e.amount === "number" ? e.amount : undefined,
      }))
      .filter((e) => e.question.length > 0),
    ...guardQuestions,
  ]);

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

// ---------------------------------------------------------------------------
// Reclassify: fix a posted categorization from chat ("that $292.67 was
// actually Kenny's invoice"). Undoes the original write (the feed line
// returns to Uncategorized) and re-applies the deposit as a customer payment
// on the named invoice — the full fix, no Zoho clicks needed from Chris.
// ---------------------------------------------------------------------------
export async function reclassifyToInvoice(opts: {
  invoiceNumber: string;
  amount?: number;
  transactionId?: string;
}): Promise<string> {
  const invoiceNumber = opts.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("no invoice number given");

  // Find the original write in the audit log — by txn id, else by amount
  // (newest first so "the $292.67 one" means the one just posted).
  const actions = (await getActions())
    .filter((a) => a.mode === "executed" && !a.reversed && a.type === "categorize-transaction")
    .reverse();
  const original = opts.transactionId
    ? actions.find((a) => a.targetId === String(opts.transactionId))
    : actions.find((a) => {
        const amt = Number((a.after as { amount?: unknown } | undefined)?.amount ?? NaN);
        return opts.amount != null && Math.abs(amt - opts.amount) < 0.005;
      });
  if (!original) {
    throw new Error(
      `couldn't find an executed categorization${opts.amount != null ? ` for $${opts.amount.toFixed(2)}` : ""} in the audit log`
    );
  }

  // Check the destination BEFORE undoing anything.
  const invoice = await fetchInvoiceByNumber(invoiceNumber);
  if (!invoice) throw new Error(`invoice ${invoiceNumber} not found in Zoho Books`);
  if (!invoice.customer_id) throw new Error(`invoice ${invoiceNumber} has no customer id on the API record`);

  // Undo the original posting — the feed line returns to Uncategorized.
  await uncategorizeTxn(original.targetId);
  await markActionReversed(original.id, "reclassify-to-invoice");

  // Re-find the line to recover its bank account id / date / amount.
  const { items } = await fetchUncategorizedBankTxns(200);
  const txn = items.find((t) => String(t.transaction_id) === original.targetId);
  if (!txn || !txn.account_id) {
    throw new Error(
      `undid the original posting, but couldn't re-locate the feed line — it's back in Uncategorized; the next batch (or a manual Match in Zoho Banking) can apply it to ${invoiceNumber}`
    );
  }
  const amt = txn.amount ?? 0;
  let summary: string;
  if (amt > invoice.balance + 0.01) {
    // The invoice is already (fully or mostly) paid — a payment was recorded
    // by hand, and this bank line IS that payment showing up in the feed. The
    // correct reconciliation is a MATCH to the recorded payment, not a second
    // payment. Use Zoho's own match candidates; a unique same-amount hit is
    // safe to take.
    const candidates = await fetchMatchCandidates(original.targetId).catch(() => []);
    const sameAmount = candidates.filter(
      (c) => c.amount == null || Math.abs((c.amount ?? 0) - amt) < 0.005
    );
    if (sameAmount.length !== 1) {
      throw new Error(
        `undid the original posting, but ${invoiceNumber} is already paid (balance $${invoice.balance.toFixed(2)}) and Zoho offered ${sameAmount.length} match candidates — the line is back in Uncategorized; match it to the recorded payment in Zoho Banking`
      );
    }
    await matchTxn(original.targetId, sameAmount);
    summary = `Reclassified $${amt.toFixed(2)}: undid "${original.summary.slice(0, 70)}" and matched the bank line to the payment already recorded on ${invoiceNumber} (${invoice.customer_name}) — revenue no longer double-counted, nothing posted twice`;
  } else {
    await categorizeTxnAsCustomerPayment(original.targetId, {
      customer_id: invoice.customer_id,
      invoice_id: invoice.invoice_id,
      amount: amt,
      date: txn.date,
      account_id: txn.account_id,
      description: txn.description,
    });
    summary = `Reclassified $${amt.toFixed(2)}: undid "${original.summary.slice(0, 70)}" and applied it as a payment on ${invoiceNumber} (${invoice.customer_name}) — revenue no longer double-counted`;
  }
  await logActions([
    makeAction({
      type: "reclassify-to-invoice",
      mode: "executed",
      targetId: original.targetId,
      summary,
      before: { undone: original.summary },
      after: { invoice: invoiceNumber, amount: amt },
      batchId: new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14),
      index: 0,
    }),
  ]);
  return summary;
}
