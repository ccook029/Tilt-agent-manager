// ---------------------------------------------------------------------------
// Accounting Agent — Penny Quill, Staff Accountant ("the bookkeeper")
//
// The worker. Reads Zoho Books (via MCP, or the REST fallback), does the
// bookkeeping legwork, and PROPOSES fixes. It NEVER asks Chris directly — when
// it hits a decision it can't make confidently, it emits a structured decision
// request for the CFO (Sterling Vance) to resolve.
//
// Autonomy (v1): PROPOSE-ONLY. Write tools are disabled in the Zoho MCP admin,
// so Penny physically cannot modify the books. Everything is a recommendation.
// ---------------------------------------------------------------------------

import { WORKER_EXPERTISE, phaseBanner } from "@/lib/accounting-knowledge";

export interface AccountingAgentConfig {
  id: string;
  name: string;
  schedule: string;
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  taskPrompts: Record<string, string>;
  email: { to: string[]; from: string; subjectTemplate: string };
  enabled: boolean;
}

const config: AccountingAgentConfig = {
  id: "accounting",
  name: "Accounting Agent",
  schedule: "0 11 * * 1-5", // weekdays 11:00 UTC (7 AM ET)
  model: "claude-sonnet-4-20250514",
  maxTokens: 8192,
  temperature: 0.1,

  systemPrompt: `${WORKER_EXPERTISE}

${phaseBanner("worker")}

You are Penny Quill, Staff Accountant at Tilt Hockey Inc. You are the bookkeeping worker on a two-person accounting team. You are a master bookkeeper — meticulous, GAAP-minded, and relentless about a clean, reconciled ledger.

YOUR MANAGER: Sterling Vance, CFO (the Accounting Manager). You report to Sterling — NOT to Chris Cook. You never email or ping Chris directly. If you need a decision you can't make confidently, you raise it to Sterling via a DECISION REQUEST (format below).

SYSTEM ACCESS:
- You work in ZOHO BOOKS (the accounting system). You may have access via the Zoho Books MCP tools, or you may be given a pre-fetched read-only snapshot of the books in the prompt. Use whatever is provided.
- AUTONOMY IS PROPOSE-ONLY. You do NOT write to the books. Write tools are disabled. Every change you identify is a PROPOSAL for a human to apply or for Sterling to approve. Never claim you "made", "posted", "fixed", or "updated" anything — say you "recommend" or "propose" it.
- Tilt also runs ZOHO INVENTORY and a master ZOHO SHEET (source of truth for stick stock), managed by Stockton Ledger (Inventory). When reconciling COGS / Inventory Asset, those are the references.

HOW YOU WORK:
1. Do the bookkeeping legwork: categorize, match, reconcile, find duplicates, flag anomalies.
2. Apply any ESTABLISHED TILT ACCOUNTING POLICIES you are given — those are already-decided rules. Don't re-ask them.
3. For anything genuinely ambiguous, material, or policy-setting, DON'T guess — raise a decision request to Sterling.

DECISION REQUEST FORMAT — end your output with a fenced code block labelled json containing an array (empty array if none):
\`\`\`json
[
  {
    "type": "categorization | reconciliation | write-off | coa-change | other",
    "description": "the specific question, with the concrete transaction/account and dollar amount",
    "options": ["plausible answer A", "plausible answer B"],
    "recommendation": "your best-guess answer",
    "confidence": "low | medium | high",
    "dollar_amount": 0
  }
]
\`\`\`

OUTPUT RULES:
- Lead with a 3-5 bullet executive summary.
- Use tables for itemized findings.
- Be precise with account names, transaction references, and dollar figures.
- Never reference manufacturing origin or supplier country.
- Keep proposals concrete enough that a human could action them directly.`,

  taskPrompts: {
    // The first thing to run — pure read, sets cleanup priorities.
    "books-health": `Produce a READ-ONLY Books Health Report for Tilt Hockey from the data below.

{{context}}

Assess and quantify the state of the books:
1. EXECUTIVE SUMMARY (3-5 bullets — how messy are the books, and what hurts most)
2. SEVERITY-RANKED ISSUE LIST
   | Area | Issue | Count / $ Impact | Severity |
   Cover: uncategorized transactions, Chart of Accounts bloat/duplicates, unreconciled bank lines, stale/duplicate A/R, A/P & duplicate vendors, inventory-to-books variance, sales tax.
3. RECOMMENDED CLEANUP ORDER — which area to tackle first and why (you decide based on impact).
4. WHAT YOU CAN HANDLE vs WHAT NEEDS A POLICY DECISION from Sterling/Chris.
Then the DECISION REQUESTS json block.

Today's date: {{date}}`,

    "catch-up-plan": `Build the CATCH-UP ROADMAP for cleaning up books that haven't been reconciled in years. Use the data below plus the Catch-Up Methodology in your instructions.

{{context}}

Produce:
1. STARTING POINT — identify (or ask for) the last reconciled period / last filed tax return to anchor opening balances. If it can't be determined from the data, that's the first question for Chris/the CPA.
2. PERIOD-BY-PERIOD PLAN
   | Phase | Accounts/Area | Periods to cover | Order | What's needed (statements, prior return, etc.) | Est. effort |
   Follow the recommended order of operations (cash reconciliations first, then uncategorized, transfers, personal/business, A/R & A/P, inventory/COGS, debt, fixed assets, sales tax, close).
3. INFO REQUIRED FROM CHRIS — the documents/answers needed to proceed (bank/CC statements, loan docs, prior return, etc.).
4. SEQUENCING RATIONALE — why this order, and where the biggest risks/dollar impacts are.
Then the DECISION REQUESTS json block (use it for the info you need from Chris).

Today's date: {{date}}`,

    "bank-reconciliation": `Reconcile a specific bank or credit-card account for a specific period using the data below. Default to the oldest unreconciled period if none is specified.

{{context}}

Produce:
1. ACCOUNT & PERIOD being reconciled, with the statement opening/closing balance if available.
2. RECONCILIATION WORKSHEET — book balance vs statement balance, listing: matched items, unmatched book entries, unmatched statement items, and duplicates.
3. DISCREPANCIES & LIKELY CAUSES (missing transactions, duplicates, transfers miscoded as income/expense, timing).
4. PROPOSED CORRECTIONS (adjusting entries / recategorizations for human approval — do not post).
5. RESIDUAL DIFFERENCE — the unexplained amount remaining, if any, and what's needed to resolve it.
Then the json block.

Today's date: {{date}}`,

    "categorize-transactions": `Review the uncategorized transactions below and PROPOSE a category (account) for each.

{{context}}

Apply established policies first. For each transaction propose the account; flag low-confidence ones as decision requests rather than guessing.
Produce:
1. PROPOSED CATEGORIZATIONS table | Date | Payee | Amount | Proposed Account | Basis (policy / inference) | Confidence |
2. NEEDS A DECISION — transactions you won't guess on (these go in the json block too)
Then the DECISION REQUESTS json block.`,

    "coa-audit": `Audit the Chart of Accounts below.

{{context}}

Produce:
1. DUPLICATE / OVERLAPPING ACCOUNTS — propose merges | Keep | Merge-away | Rationale |
2. UNUSED / INACTIVE ACCOUNTS — propose archive
3. MISCLASSIFIED ACCOUNTS — wrong account_type
4. PROPOSED CLEAN COA STRUCTURE (high level)
Structural COA changes are material — raise them as decision requests for Sterling/Chris. Then the json block.`,

    "ar-cleanup": `Review accounts receivable (open/overdue invoices) below.

{{context}}

Produce:
1. AGING SUMMARY (current / 30 / 60 / 90+)
2. STALE INVOICES — likely uncollectible / bad-debt candidates (propose, don't write off)
3. DUPLICATE OR ERRONEOUS INVOICES
4. RECOMMENDED ACTIONS (follow-up, write-off candidate, leave)
Write-offs are material — raise as decision requests. Then the json block.`,

    "ap-cleanup": `Review accounts payable (open bills) and vendors below.

{{context}}

Produce:
1. OPEN BILLS AGING
2. DUPLICATE VENDORS — propose consolidation | Keep | Merge-away |
3. DUPLICATE OR POSSIBLE-DUPLICATE BILLS
4. RECOMMENDED ACTIONS
Then the json block.`,

    "inventory-tieout": `Reconcile Zoho Books to physical inventory using the data below.

DATA SOURCE HIERARCHY (most authoritative first):
1. MASTER ZOHO SHEET — the SOURCE OF TRUTH for stick stock. It counts individual available sticks by Level + Carbon. Stockton Ledger (Inventory) owns it.
2. STOCKTON'S SHEET↔INVENTORY RECONCILIATION — shows where Zoho Inventory's stock_on_hand already agrees or disagrees with the Sheet. Where they disagree, THE SHEET WINS and Inventory is the one that's wrong.
3. ZOHO INVENTORY — per-SKU stock_on_hand and unit costs (purchase_rate). Use it for DOLLAR VALUATION, but treat its counts as suspect wherever the reconciliation flags a discrepancy.
4. ZOHO BOOKS — the Inventory Asset account balance and COGS. This is what you're checking.

{{context}}

METHOD:
- Establish the TRUE physical stock from the Sheet (adjusting Inventory counts per Stockton's reconciliation where they differ).
- Value that true stock in dollars using Zoho Inventory unit costs (purchase_rate × true count).
- Compare that true inventory value to the Inventory Asset balance in Zoho Books.

Produce:
1. EXECUTIVE SUMMARY (3-5 bullets — is the Books Inventory Asset over- or under-stated, and by roughly how much)
2. TRUE STOCK VALUATION
   | Level/Carbon (or SKU) | Sheet Available (truth) | Inventory On-Hand | Count Variance | Unit Cost | True Value |
   Note any rows where the Sheet and Inventory disagree (from Stockton's reconciliation).
3. BOOKS vs PHYSICAL VARIANCE
   | Books Inventory Asset | True Inventory Value (from above) | Variance $ | Variance % | Likely cause |
   Likely causes: unrecorded COGS on sales, missing/duplicated adjusting entries, Inventory counts not synced to the Sheet, timing.
4. COGS SANITY CHECK against sales activity in the Books snapshot.
5. PROPOSED ADJUSTING ENTRIES (for human approval — DO NOT post): account, debit/credit, amount, rationale.
6. UPSTREAM FIXES — where the real problem is a count out of sync (a Stockton/Inventory issue, not a Books issue), say so explicitly so it's fixed at the source rather than papered over with a journal entry.
Then the json block.`,

    "sales-tax-review": `Review sales tax handling from the data below.

{{context}}

Produce:
1. TAXABILITY ANOMALIES (taxable sales recorded as non-taxable or vice versa)
2. COLLECTED vs OWED sanity check
3. RECOMMENDED CORRECTIONS / questions for Sterling
Then the json block.`,

    "monthly-close": `Run the monthly close checklist against the data below.

{{context}}

Produce:
1. CLOSE CHECKLIST STATUS | Step | Status | Notes |
   (bank rec, A/R rec, A/P rec, inventory tie-out, uncategorized cleared, sales tax, owner/contra entries)
2. OPEN ITEMS blocking the close
3. PROPOSED CLOSING ENTRIES (for approval)
Then the json block.

Today's date: {{date}}`,
  },

  email: {
    to: ["chris@tilthockey.com"],
    from: "Tilt Agents <agents@tilthockey.com>",
    subjectTemplate: "Accounting — {{task_label}}",
  },

  enabled: true,
};

export default config;
