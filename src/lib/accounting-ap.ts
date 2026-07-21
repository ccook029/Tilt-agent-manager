// ---------------------------------------------------------------------------
// accounting-ap.ts — Penny's AP Inbox: read bills from the Zoho Books Documents
// inbox and propose an entry, which Chris approves before it's created in Zoho.
//
// Flow (propose → approve → create, per Chris):
//   1. buildApProposals() lists unprocessed inbox docs, downloads each PDF/image,
//      and has Penny read it: extract vendor/date/ref/amount, classify Bill vs
//      Expense (cross-checking the e-Transfer feed for "already paid"), and pick
//      the expense account (and, for an expense, the paid-through account) from
//      the real Chart of Accounts. Proposals are stored for review.
//   2. approveProposal() creates the Bill or Expense in Zoho.
//   3. rejectProposal() dismisses it.
//
// Nothing is written to the books without an explicit approval.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { callClaude } from "./anthropic";
import { CLAUDE_MODEL } from "./models";
import { fetchInboxDocuments, downloadDocument, type InboxDocument } from "./zoho-documents";
import {
  fetchChartOfAccounts,
  findOrCreateVendor,
  createBill,
  createExpense,
  fetchRecentPayables,
  recordVendorPayment,
  attachToTransaction,
  fetchTaxes,
  fetchCurrencies,
  type BooksAccount,
  type ExistingPayable,
  type ZohoTax,
  type ZohoCurrency,
} from "./zoho-books";
import { isInboxConfigured, fetchInteracNotifications } from "./email-inbox";

export interface ApProposal {
  id: string;
  documentId: string;
  fileName: string;
  entryType: "bill" | "expense";
  vendor: string;
  date: string; // YYYY-MM-DD
  reference?: string; // invoice / bill number
  amount: number; // grand total (incl. tax)
  currency?: string; // e.g. CAD, USD
  exchangeRate?: number; // foreign → base, when currency isn't CAD
  taxAmount?: number; // tax portion of the total (for ITCs)
  taxRate?: number; // e.g. 13 for HST
  taxName?: string; // e.g. "HST", "GST"
  expenseAccount: string; // GL account name Penny chose
  paidThroughAccount?: string; // for an expense: which bank/cash it was paid from
  alreadyPaid: boolean;
  paidVia?: string; // e.g. "e-Transfer 2026-07-21"
  confidence: "high" | "medium" | "low";
  rationale: string;
  /** Set when this looks like it's already in Zoho — a short description of the match. */
  duplicateOf?: string;
  status: "proposed" | "created" | "rejected" | "error";
  zohoId?: string;
  zohoNumber?: string;
  error?: string;
  /** Non-fatal note after a successful create (e.g. payment/attach couldn't complete). */
  warning?: string;
  /** Set when a learned rule for this vendor pre-filled the account. */
  learnedRule?: boolean;
  createdAt: string;
  decidedAt?: string;
}

const KEY = "accounting-ap-proposals";
const MAX = 200;

async function loadProposals(): Promise<ApProposal[]> {
  return (await kv.get<ApProposal[]>(KEY)) ?? [];
}
async function saveProposals(rows: ApProposal[]): Promise<void> {
  await kv.set(KEY, rows.slice(-MAX));
}

// ---- Learned vendor rules -------------------------------------------------
// When Chris approves a bill, we remember vendor → account so the same vendor
// is coded consistently next time without him re-picking.
export interface VendorRule {
  expenseAccount: string;
  paidThroughAccount?: string;
  entryType?: "bill" | "expense";
  updatedAt: string;
}
const RULES_KEY = "accounting-ap-vendor-rules";

export async function getVendorRules(): Promise<Record<string, VendorRule>> {
  return (await kv.get<Record<string, VendorRule>>(RULES_KEY)) ?? {};
}
async function setVendorRule(
  vendor: string,
  r: Omit<VendorRule, "updatedAt">
): Promise<void> {
  const key = vendorKey(vendor);
  if (!key || !r.expenseAccount) return;
  const all = await getVendorRules();
  all[key] = { ...r, updatedAt: new Date().toISOString() };
  await kv.set(RULES_KEY, all);
}

/** Apply Chris's edits to a proposal before it's created. */
function applyEdits(p: ApProposal, e: Record<string, unknown>): void {
  const s = (k: string) => (typeof e[k] === "string" ? (e[k] as string).trim() : undefined);
  if (e.entryType === "bill" || e.entryType === "expense") p.entryType = e.entryType;
  const v = s("vendor");
  if (v) p.vendor = v;
  const d = s("date");
  if (d) p.date = d;
  if ("reference" in e) p.reference = s("reference") || undefined;
  const ea = s("expenseAccount");
  if (ea) p.expenseAccount = ea;
  if ("paidThroughAccount" in e) p.paidThroughAccount = s("paidThroughAccount") || undefined;
  if (typeof e.amount === "number" && e.amount > 0) p.amount = e.amount;
  else {
    const n = parseFloat(String(e.amount ?? ""));
    if (!Number.isNaN(n) && n > 0) p.amount = n;
  }
  if (typeof e.alreadyPaid === "boolean") p.alreadyPaid = e.alreadyPaid;
}

export async function listProposals(): Promise<ApProposal[]> {
  const rows = await loadProposals();
  // Proposed first, then most recent.
  return rows.sort((a, b) => {
    const rank = (s: ApProposal["status"]) => (s === "proposed" ? 0 : s === "error" ? 1 : 2);
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

// ---- Extraction -----------------------------------------------------------

const AP_SYSTEM = `You are Penny Quill, Staff Accountant at Tilt Hockey. You read an accounts-payable document (a vendor bill or a paid receipt) and produce ONE structured entry proposal. You are precise and conservative: if a figure isn't clearly on the document, mark confidence "low" and say what's uncertain. You never invent a vendor or amount.`;

function apUserPrompt(coa: string, etransfers: string, rules: string, fileName: string): string {
  return `Read the attached AP document ("${fileName}") and propose how to record it in Zoho Books.

## Chart of Accounts (choose account names EXACTLY from this list)
${coa}

## Saved vendor rules (Chris's past decisions — if this vendor matches, USE this account)
${rules}

## Recent e-Transfer payments (to decide if this bill is ALREADY PAID — match by vendor + amount + date)
${etransfers}

Decide:
- entryType: "bill" for a vendor INVOICE (keeps the invoice on file), even if it's already been paid. Use "expense" only for a paid receipt with no formal invoice.
- alreadyPaid + paidVia: whether it's been paid and how — cross-check the e-Transfers above and cite the match (vendor + amount + date). A paid invoice is still a "bill"; the payment gets recorded separately.
- expenseAccount: the best-fit EXPENSE account name from the list above.
- paidThroughAccount: the bank/cash account the money left — REQUIRED whenever alreadyPaid is true (for BOTH bill and expense). Pick it from the list (an e-Transfer leaves the main chequing account).

Also capture:
- amount: the GRAND TOTAL including tax.
- taxAmount / taxRate / taxName: the sales tax on the bill (e.g. 13 / "HST" / GST) so we can claim the input tax credit. Use null if there's no tax line.
- currency: the document's currency (CAD unless the bill clearly states otherwise — factory bills are often USD). exchangeRate only if the document shows one.

Respond with ONLY a JSON object, no prose:
\`\`\`json
{
  "entryType": "bill" | "expense",
  "vendor": "exact vendor/supplier name",
  "date": "YYYY-MM-DD",
  "reference": "invoice or bill number, or null",
  "amount": 0.00,
  "currency": "CAD",
  "exchangeRate": null,
  "taxAmount": 0.00,
  "taxRate": 0,
  "taxName": "HST/GST/… or null",
  "expenseAccount": "exact account name from the list",
  "paidThroughAccount": "exact account name, or null",
  "alreadyPaid": true | false,
  "paidVia": "short note or null",
  "confidence": "high" | "medium" | "low",
  "rationale": "one line: what this is and why this account"
}
\`\`\``;
}

function parseJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---- Duplicate detection --------------------------------------------------
const digitsOnly = (s?: string) => (s ?? "").replace(/\D/g, "");
const vendorKey = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Does this proposal already exist in Zoho? Matches $ + invoice number, or
 *  $ + date + a similar vendor name (catches "Scott Brown" vs "Scotty Brown"). */
function matchExisting(
  p: { amount: number; reference?: string; vendor: string; date: string },
  existing: ExistingPayable[]
): ExistingPayable | null {
  for (const e of existing) {
    if (Math.abs(e.amount - p.amount) > 0.01) continue;
    const pref = digitsOnly(p.reference);
    const eref = digitsOnly(e.reference);
    if (pref && eref && pref === eref) return e; // same $ + same invoice number
    const pv = vendorKey(p.vendor);
    const ev = vendorKey(e.vendor);
    const vendorClose = !!pv && !!ev && (pv.includes(ev) || ev.includes(pv));
    if (e.date === p.date && vendorClose) return e; // same $ + date + similar vendor
  }
  return null;
}

function describePayable(e: ExistingPayable): string {
  return `${e.type} ${e.number || "(no #)"} — ${e.vendor || "?"}, $${e.amount.toFixed(2)}, ${e.date}`;
}

/** Match the bill's tax to a configured Zoho tax (by rate, then by name). */
function resolveTax(p: ApProposal, taxes: ZohoTax[]): ZohoTax | null {
  if (!((p.taxAmount ?? 0) > 0)) return null;
  if (p.taxRate && p.taxRate > 0) {
    const byRate = taxes.find((t) => Math.abs(t.tax_percentage - (p.taxRate as number)) < 0.4);
    if (byRate) return byRate;
  }
  if (p.taxName) {
    const n = p.taxName.toLowerCase();
    const byName = taxes.find((t) => t.tax_name.toLowerCase().includes(n));
    if (byName) return byName;
  }
  return null;
}

/** Match the bill's currency to a Zoho currency (null when it's the base currency). */
function resolveCurrency(
  code: string | undefined,
  currencies: ZohoCurrency[]
): { currency: ZohoCurrency; foreign: boolean } | null {
  if (!code) return null;
  const hit = currencies.find((c) => c.currency_code.toUpperCase() === code.toUpperCase());
  if (!hit) return null;
  return { currency: hit, foreign: !hit.is_base_currency };
}

function errorProposal(doc: InboxDocument, error: string): ApProposal {
  return {
    id: `ap-${doc.id}`,
    documentId: doc.id,
    fileName: doc.fileName,
    entryType: "bill",
    vendor: "",
    date: "",
    amount: 0,
    expenseAccount: "",
    alreadyPaid: false,
    confidence: "low",
    rationale: "",
    status: "error",
    error,
    createdAt: new Date().toISOString(),
  };
}

function toProposal(doc: InboxDocument, p: Record<string, unknown>): ApProposal {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : undefined);
  const entryType = s("entryType") === "expense" ? "expense" : "bill";
  const num = (k: string) => {
    const v = p[k];
    if (typeof v === "number") return v;
    const n = parseFloat(String(v ?? ""));
    return Number.isNaN(n) ? undefined : n;
  };
  const amount = num("amount") ?? 0;
  const conf = s("confidence");
  return {
    id: `ap-${doc.id}`,
    documentId: doc.id,
    fileName: doc.fileName,
    entryType,
    vendor: s("vendor") ?? "",
    date: s("date") ?? "",
    reference: s("reference") || undefined,
    amount,
    currency: (s("currency") || "CAD").toUpperCase(),
    exchangeRate: num("exchangeRate"),
    taxAmount: num("taxAmount"),
    taxRate: num("taxRate"),
    taxName: s("taxName") || undefined,
    expenseAccount: s("expenseAccount") ?? "",
    paidThroughAccount: s("paidThroughAccount") || undefined,
    alreadyPaid: p.alreadyPaid === true,
    paidVia: s("paidVia") || undefined,
    confidence: conf === "high" || conf === "medium" || conf === "low" ? conf : "low",
    rationale: s("rationale") ?? "",
    status: "proposed",
    createdAt: new Date().toISOString(),
  };
}

/** Read up to `limit` unprocessed inbox docs and propose entries. */
export async function buildApProposals(opts?: { limit?: number }): Promise<{
  proposals: ApProposal[];
  scanned: number;
  skipped: string[];
}> {
  const limit = opts?.limit ?? 5;
  const [inbox, accounts, interac, existing, payables, rules] = await Promise.all([
    fetchInboxDocuments({ max: 50 }),
    fetchChartOfAccounts().catch(() => [] as BooksAccount[]),
    isInboxConfigured()
      ? fetchInteracNotifications({ max: 60 }).catch(() => [])
      : Promise.resolve([]),
    loadProposals(),
    fetchRecentPayables().catch(() => [] as ExistingPayable[]),
    getVendorRules().catch(() => ({} as Record<string, VendorRule>)),
  ]);

  const done = new Set(
    existing.filter((p) => p.status === "created").map((p) => p.documentId)
  );
  const queue = inbox.documents.filter((d) => !done.has(d.id)).slice(0, limit);

  const coaBlock =
    accounts
      .filter((a) => a.is_active !== false)
      .map((a) => `- ${a.account_name} [${a.account_type}]`)
      .join("\n") || "(chart of accounts unavailable)";
  const etBlock =
    interac.length > 0
      ? interac
          .slice(0, 40)
          .map(
            (n) =>
              `- ${n.date} ${n.direction} ${n.name ?? "?"} $${n.amount ?? "?"}${n.message ? ` "${n.message}"` : ""}`
          )
          .join("\n")
      : "(no e-Transfer notifications available)";
  const ruleEntries = Object.entries(rules);
  const rulesBlock =
    ruleEntries.length > 0
      ? ruleEntries
          .map(
            ([k, r]) =>
              `- ${k}: ${r.entryType ?? "bill"} → ${r.expenseAccount}${r.paidThroughAccount ? ` (paid through ${r.paidThroughAccount})` : ""}`
          )
          .join("\n")
      : "(no saved rules yet)";

  const fresh: ApProposal[] = [];
  const skipped: string[] = [];
  for (const doc of queue) {
    const dl = await downloadDocument(doc.id);
    if (!dl) {
      fresh.push(errorProposal(doc, "Could not download the file from Zoho"));
      continue;
    }
    const ct = dl.contentType.toLowerCase();
    const isPdf = ct.includes("pdf");
    const isImage = ct.startsWith("image/");
    if (!isPdf && !isImage) {
      skipped.push(`${doc.fileName} (${dl.contentType})`);
      fresh.push(errorProposal(doc, `Unsupported file type (${dl.contentType}) — convert to PDF/image`));
      continue;
    }
    try {
      const res = await callClaude({
        systemPrompt: AP_SYSTEM,
        userMessage: apUserPrompt(coaBlock, etBlock, rulesBlock, doc.fileName),
        model: CLAUDE_MODEL,
        maxTokens: 1500,
        temperature: 0,
        documents: isPdf ? [{ base64: dl.base64 }] : undefined,
        images: isImage
          ? [{ mediaType: ct.split(";")[0], data: dl.base64 }]
          : undefined,
      });
      const parsed = parseJson(res.text);
      if (parsed) {
        const prop = toProposal(doc, parsed);
        // A saved rule for this vendor wins over the model's account pick.
        const rule = rules[vendorKey(prop.vendor)];
        if (rule) {
          prop.expenseAccount = rule.expenseAccount;
          if (rule.paidThroughAccount) prop.paidThroughAccount = rule.paidThroughAccount;
          if (rule.entryType) prop.entryType = rule.entryType;
          prop.learnedRule = true;
          prop.confidence = "high";
        }
        const dup = matchExisting(prop, payables);
        if (dup) prop.duplicateOf = describePayable(dup);
        fresh.push(prop);
      } else {
        fresh.push(errorProposal(doc, "Couldn't parse the extraction"));
      }
    } catch (e) {
      fresh.push(errorProposal(doc, e instanceof Error ? e.message : String(e)));
    }
  }

  // Merge: replace any prior non-created proposal for the same document.
  const freshIds = new Set(fresh.map((p) => p.documentId));
  const merged = [
    ...existing.filter((p) => p.status === "created" || !freshIds.has(p.documentId)),
    ...fresh,
  ];
  await saveProposals(merged);
  return { proposals: fresh, scanned: queue.length, skipped };
}

// ---- Approve / reject -----------------------------------------------------

export async function approveProposal(
  id: string,
  force = false,
  edits?: Record<string, unknown>
): Promise<ApProposal> {
  const all = await loadProposals();
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error("Proposal not found");
  if (p.status === "created") return p;

  // Apply Chris's edits (account/vendor/amount/…) before anything else.
  if (edits) applyEdits(p, edits);

  // Duplicate guard: don't book something already in Zoho unless Chris forces it.
  if (!force) {
    const payables = await fetchRecentPayables().catch(() => [] as ExistingPayable[]);
    const dup = matchExisting(p, payables);
    if (dup) {
      p.duplicateOf = describePayable(dup);
      p.status = "proposed";
      p.error = undefined;
      await saveProposals(all);
      return p; // blocked — the UI shows the warning + a "Create anyway" action
    }
    p.duplicateOf = undefined;
  }

  try {
    const accounts = await fetchChartOfAccounts();
    const find = (name?: string) =>
      accounts.find(
        (a) => a.account_name.trim().toLowerCase() === (name ?? "").trim().toLowerCase()
      );
    const expense = find(p.expenseAccount);
    if (!expense) throw new Error(`Expense account "${p.expenseAccount}" not found in the Chart of Accounts`);
    if (!p.vendor) throw new Error("No vendor on the proposal");
    if (!p.date || !(p.amount > 0)) throw new Error("Missing date or amount");
    const paidThrough = find(p.paidThroughAccount);
    const warnings: string[] = [];

    // Resolve tax + currency (best-effort — degrade to plain if unmatched).
    const [taxes, currencies] = await Promise.all([
      fetchTaxes().catch(() => [] as ZohoTax[]),
      fetchCurrencies().catch(() => [] as ZohoCurrency[]),
    ]);
    const tax = resolveTax(p, taxes);
    if ((p.taxAmount ?? 0) > 0 && !tax) {
      warnings.push(
        `saw ${p.taxName ?? "tax"} of $${(p.taxAmount ?? 0).toFixed(2)} but couldn't match a Zoho tax rate — booked tax-inclusive; add the tax manually to claim the ITC`
      );
    }
    const cur = resolveCurrency(p.currency, currencies);
    if (p.currency && p.currency !== "CAD" && (!cur || !cur.foreign)) {
      warnings.push(
        `bill is in ${p.currency} but that currency isn't set up in Zoho — booked in the base currency`
      );
    }
    const currencyId = cur?.foreign ? cur.currency.currency_id : undefined;
    const exchangeRate = cur?.foreign ? p.exchangeRate : undefined;
    // When a tax is applied, the line/amount must be PRE-tax (Zoho adds the tax).
    const preTax =
      tax && (p.taxAmount ?? 0) > 0 ? Number((p.amount - (p.taxAmount as number)).toFixed(2)) : p.amount;

    if (p.entryType === "expense") {
      if (!paidThrough)
        throw new Error(`Paid-through account "${p.paidThroughAccount ?? "(none)"}" not found`);
      const vendorId = await findOrCreateVendor(p.vendor).catch(() => undefined);
      const r = await createExpense({
        accountId: expense.account_id,
        paidThroughAccountId: paidThrough.account_id,
        date: p.date,
        amount: preTax,
        vendorId,
        reference: p.reference,
        description: `${p.fileName} — ${p.rationale}`.slice(0, 200),
        taxId: tax?.tax_id,
        currencyId,
        exchangeRate,
      });
      p.zohoId = r.expense_id;
      // An expense already records the payment from the paid-through account.
    } else {
      const vendorId = await findOrCreateVendor(p.vendor);
      const r = await createBill({
        vendorId,
        billNumber: p.reference,
        date: p.date,
        lineItems: [
          { accountId: expense.account_id, description: p.fileName, amount: preTax, taxId: tax?.tax_id },
        ],
        notes: p.rationale,
        currencyId,
        exchangeRate,
      });
      p.zohoId = r.bill_id;
      p.zohoNumber = r.bill_number;

      // Already paid → record the vendor payment so it isn't left overdue in A/P.
      if (p.alreadyPaid) {
        if (paidThrough) {
          try {
            await recordVendorPayment({
              vendorId,
              billId: r.bill_id,
              amount: p.amount,
              date: p.date,
              paidThroughAccountId: paidThrough.account_id,
            });
          } catch (e) {
            warnings.push(
              `booked the bill but couldn't record the payment (${e instanceof Error ? e.message : String(e)}) — mark it paid in Zoho`
            );
          }
        } else {
          warnings.push(
            "flagged already-paid but no paid-through account was set, so it'll show unpaid until you record the payment"
          );
        }
      }
    }

    // Attach the source PDF to the created entry (best-effort audit trail).
    try {
      const dl = await downloadDocument(p.documentId);
      if (dl) {
        await attachToTransaction(
          p.entryType === "bill" ? "bills" : "expenses",
          p.zohoId,
          p.fileName,
          dl.base64,
          dl.contentType
        );
      }
    } catch {
      warnings.push("couldn't attach the source PDF to the entry");
    }

    p.status = "created";
    p.error = undefined;
    p.warning = warnings.length > 0 ? warnings.join("; ") : undefined;
    p.decidedAt = new Date().toISOString();

    // Remember how Chris coded this vendor, so next time is one click.
    await setVendorRule(p.vendor, {
      expenseAccount: p.expenseAccount,
      paidThroughAccount: p.paidThroughAccount,
      entryType: p.entryType,
    }).catch(() => {});
  } catch (e) {
    p.status = "error";
    p.error = e instanceof Error ? e.message : String(e);
  }
  await saveProposals(all);
  return p;
}

export async function rejectProposal(id: string): Promise<ApProposal | null> {
  const all = await loadProposals();
  const p = all.find((x) => x.id === id);
  if (!p) return null;
  p.status = "rejected";
  p.decidedAt = new Date().toISOString();
  await saveProposals(all);
  return p;
}
