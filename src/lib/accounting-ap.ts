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
  type BooksAccount,
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
  amount: number;
  currency?: string;
  expenseAccount: string; // GL account name Penny chose
  paidThroughAccount?: string; // for an expense: which bank/cash it was paid from
  alreadyPaid: boolean;
  paidVia?: string; // e.g. "e-Transfer 2026-07-21"
  confidence: "high" | "medium" | "low";
  rationale: string;
  status: "proposed" | "created" | "rejected" | "error";
  zohoId?: string;
  zohoNumber?: string;
  error?: string;
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

function apUserPrompt(coa: string, etransfers: string, fileName: string): string {
  return `Read the attached AP document ("${fileName}") and propose how to record it in Zoho Books.

## Chart of Accounts (choose account names EXACTLY from this list)
${coa}

## Recent e-Transfer payments (to decide if this bill is ALREADY PAID — match by vendor + amount + date)
${etransfers}

Decide:
- entryType: "expense" if it's already been paid (e.g. a matching e-Transfer above, or it's a receipt), otherwise "bill" (money we still owe).
- expenseAccount: the best-fit EXPENSE account name from the list above.
- paidThroughAccount: ONLY for an expense — the bank/cash account it was paid from (from the list). Omit for a bill.
- alreadyPaid + paidVia: whether it's paid and how (cite the e-Transfer if matched).

Respond with ONLY a JSON object, no prose:
\`\`\`json
{
  "entryType": "bill" | "expense",
  "vendor": "exact vendor/supplier name",
  "date": "YYYY-MM-DD",
  "reference": "invoice or bill number, or null",
  "amount": 0.00,
  "currency": "CAD",
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
  const amount = typeof p.amount === "number" ? p.amount : parseFloat(String(p.amount ?? "0")) || 0;
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
    currency: s("currency") || "CAD",
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
  const [inbox, accounts, interac, existing] = await Promise.all([
    fetchInboxDocuments({ max: 50 }),
    fetchChartOfAccounts().catch(() => [] as BooksAccount[]),
    isInboxConfigured()
      ? fetchInteracNotifications({ max: 60 }).catch(() => [])
      : Promise.resolve([]),
    loadProposals(),
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
        userMessage: apUserPrompt(coaBlock, etBlock, doc.fileName),
        model: CLAUDE_MODEL,
        maxTokens: 1500,
        temperature: 0,
        documents: isPdf ? [{ base64: dl.base64 }] : undefined,
        images: isImage
          ? [{ mediaType: ct.split(";")[0], data: dl.base64 }]
          : undefined,
      });
      const parsed = parseJson(res.text);
      fresh.push(parsed ? toProposal(doc, parsed) : errorProposal(doc, "Couldn't parse the extraction"));
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

export async function approveProposal(id: string): Promise<ApProposal> {
  const all = await loadProposals();
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error("Proposal not found");
  if (p.status === "created") return p;

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

    if (p.entryType === "expense") {
      const paidThrough = find(p.paidThroughAccount);
      if (!paidThrough)
        throw new Error(`Paid-through account "${p.paidThroughAccount ?? "(none)"}" not found`);
      const vendorId = await findOrCreateVendor(p.vendor).catch(() => undefined);
      const r = await createExpense({
        accountId: expense.account_id,
        paidThroughAccountId: paidThrough.account_id,
        date: p.date,
        amount: p.amount,
        vendorId,
        reference: p.reference,
        description: `${p.fileName} — ${p.rationale}`.slice(0, 200),
      });
      p.zohoId = r.expense_id;
    } else {
      const vendorId = await findOrCreateVendor(p.vendor);
      const r = await createBill({
        vendorId,
        billNumber: p.reference,
        date: p.date,
        lineItems: [{ accountId: expense.account_id, description: p.fileName, amount: p.amount }],
        notes: p.rationale,
      });
      p.zohoId = r.bill_id;
      p.zohoNumber = r.bill_number;
    }
    p.status = "created";
    p.error = undefined;
    p.decidedAt = new Date().toISOString();
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
