// ---------------------------------------------------------------------------
// zoho-books.ts — Zoho Books client for the Accounting team
//
// Two connection paths, by design:
//
//   1. MCP (preferred)   — the official Zoho Books MCP server, driven through
//      Anthropic's `mcp_servers` connector. Enabled when ZOHO_BOOKS_MCP_URL is
//      set. Tool access (read-only in v1) is controlled in the Zoho admin, so
//      "propose-only" is enforced at the source, not just by the prompt.
//
//   2. REST (fallback)   — direct calls to the Zoho Books v3 API using the same
//      OAuth refresh-token flow Stockton already uses for Inventory. Always
//      available, so the agents can do read/diagnostic work even before the MCP
//      admin steps are done.
//
// Reuses getAccessToken() / getEnvOrThrow() from zoho.ts so there is ONE OAuth
// flow for the whole app.
//
// Required env (REST path): ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
//   ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID  (already set for Stockton)
// Optional env (MCP path): ZOHO_BOOKS_MCP_URL, ZOHO_BOOKS_MCP_TOKEN
// ---------------------------------------------------------------------------
import { getAccessToken, getEnvOrThrow, invalidateTokenCache } from "./zoho";

// ---- MCP connector configuration ------------------------------------------

export interface McpServerConfig {
  type: "url";
  url: string;
  name: string;
  authorization_token?: string;
}

/**
 * Returns the Zoho Books MCP server config for Anthropic's mcp_servers
 * connector, or null when MCP isn't configured (→ use the REST fallback).
 */
export function getZohoBooksMcpConfig(): McpServerConfig | null {
  const url = process.env.ZOHO_BOOKS_MCP_URL;
  if (!url) return null;
  const token = process.env.ZOHO_BOOKS_MCP_TOKEN;
  return {
    type: "url",
    url,
    name: "zoho-books",
    ...(token ? { authorization_token: token } : {}),
  };
}

export function isMcpConfigured(): boolean {
  return getZohoBooksMcpConfig() !== null;
}

// ---- REST helper ----------------------------------------------------------

async function booksGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";

  const url = new URL(`${domain}/books/v3${path}`);
  url.searchParams.set("organization_id", orgId);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) await invalidateTokenCache();
    throw new Error(`Zoho Books ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---- Read types (partial, relevant fields) --------------------------------

export interface BooksAccount {
  account_id: string;
  account_name: string;
  account_type: string;
  is_active: boolean;
  is_user_created: boolean;
  description?: string;
}

export interface BooksBankTxn {
  transaction_id: string;
  date: string;
  amount: number;
  payee?: string;
  description?: string;
  status: string; // categorized | uncategorized | matched ...
  account_name?: string;
  /** The bank/CC account this feed line belongs to. */
  account_id?: string;
  /** "debit" = money out of the bank account, "credit" = money in. */
  debit_or_credit?: string;
  /** Zoho's guessed type for the feed line (deposit, expense, ...). */
  transaction_type?: string;
}

/**
 * Determine a feed line's money direction from every available signal. Zoho
 * doesn't reliably populate debit_or_credit on uncategorized lines, so fall
 * back to the transaction_type and finally the bank's own "credit memo" /
 * "debit memo" wording in the description. "unknown" means DON'T act on it.
 */
export function txnDirection(t: BooksBankTxn): "in" | "out" | "unknown" {
  const flag = (t.debit_or_credit ?? "").toLowerCase();
  if (flag === "credit") return "in";
  if (flag === "debit") return "out";

  const type = (t.transaction_type ?? "").toLowerCase();
  if (["deposit", "customer_payment", "refund", "other_income", "interest_income", "sales_without_invoices"].includes(type)) return "in";
  if (["expense", "vendor_payment", "card_payment", "credit_card_payment", "owner_drawings"].includes(type)) return "out";

  const desc = (t.description ?? "").toLowerCase();
  if (/credit memo|\bdeposit\b/.test(desc)) return "in";
  if (/debit memo|\bwithdrawal\b/.test(desc)) return "out";

  return "unknown";
}

export interface BooksInvoice {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  status: string;
  total: number;
  balance: number;
  date: string;
  due_date: string;
}

export interface BooksBill {
  bill_id: string;
  bill_number: string;
  vendor_name: string;
  status: string;
  total: number;
  balance: number;
  date: string;
  due_date: string;
}

// ---- Read calls (paginated) -----------------------------------------------

async function getAllPages<T>(
  path: string,
  listKey: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  while (true) {
    const res = await booksGet<Record<string, unknown>>(path, {
      ...params,
      page: String(page),
      per_page: "200",
    });
    const items = (res[listKey] as T[]) ?? [];
    out.push(...items);
    const ctx = res.page_context as { has_more_page?: boolean } | undefined;
    if (!ctx?.has_more_page) break;
    page++;
    if (page > 10) break; // safety
  }
  return out;
}

/**
 * Fetch ONLY the first page plus Zoho's reported total count. Used by the
 * read-only health snapshot so a multi-year backlog of thousands of rows
 * doesn't trigger deep pagination (and a serverless timeout) — we get the true
 * count from page_context.total and a 200-row sample for context.
 */
async function fetchPageWithTotal<T>(
  path: string,
  listKey: string,
  params: Record<string, string> = {}
): Promise<{ items: T[]; total: number }> {
  const res = await booksGet<Record<string, unknown>>(path, {
    ...params,
    page: "1",
    per_page: "200",
  });
  const items = (res[listKey] as T[]) ?? [];
  const ctx = res.page_context as { total?: number } | undefined;
  return { items, total: ctx?.total ?? items.length };
}

export const fetchChartOfAccounts = () =>
  getAllPages<BooksAccount>("/chartofaccounts", "chartofaccounts");

export interface BooksBankAccount {
  account_id: string;
  account_name: string;
  account_type: string;
}

export const fetchBankAccounts = () =>
  getAllPages<BooksBankAccount>("/bankaccounts", "bankaccounts");

/**
 * Uncategorized bank/credit-card transactions. Zoho Books' /banktransactions
 * endpoint REQUIRES an account_id (querying it without one returns
 * "The account does not exist"), so we enumerate the bank accounts first and
 * pull each one's uncategorized feed. Returns a sample plus the true total.
 */
export async function fetchUncategorizedBankTxns(
  sampleLimit = 40
): Promise<{ items: BooksBankTxn[]; total: number }> {
  const accounts = await fetchBankAccounts();
  const items: BooksBankTxn[] = [];
  let total = 0;

  for (const acct of accounts) {
    try {
      const res = await booksGet<Record<string, unknown>>("/banktransactions", {
        account_id: acct.account_id,
        status: "uncategorized",
        page: "1",
        per_page: "200",
      });
      const txns = (res.banktransactions as BooksBankTxn[]) ?? [];
      const ctx = res.page_context as { total?: number } | undefined;
      total += ctx?.total ?? txns.length;
      for (const t of txns) {
        if (items.length >= sampleLimit) break;
        items.push({
          ...t,
          account_name: acct.account_name,
          account_id: t.account_id ?? acct.account_id,
        });
      }
    } catch {
      // Skip an account we can't read rather than failing the whole snapshot.
    }
  }

  return { items, total };
}

export const fetchOpenInvoices = () =>
  getAllPages<BooksInvoice>("/invoices", "invoices", { status: "unpaid" });

export const fetchOpenBills = () =>
  getAllPages<BooksBill>("/bills", "bills", { status: "unpaid" });

// ---- Write operations (Wave 1: bank-transaction categorization) -----------
//
// These are the Accounting team's "hands". Scope is deliberately narrow:
// categorize an uncategorized bank feed line, and un-categorize it (the
// reversal, which is what makes autonomous categorization safe to run).

async function booksPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";

  const url = new URL(`${domain}/books/v3${path}`);
  url.searchParams.set("organization_id", orgId);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) await invalidateTokenCache();
    throw new Error(`Zoho Books POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Categorize a money-OUT feed line as an expense to the given expense account. */
export async function categorizeTxnAsExpense(
  transactionId: string,
  opts: {
    account_id: string; // the expense account
    paid_through_account_id: string; // the bank/CC account the money left
    date: string;
    amount: number;
    description?: string;
  }
): Promise<void> {
  await booksPost(
    `/banktransactions/uncategorized/${transactionId}/categorize/expenses`,
    {
      account_id: opts.account_id,
      paid_through_account_id: opts.paid_through_account_id,
      date: opts.date,
      amount: opts.amount,
      description: opts.description ?? "",
    }
  );
}

/** Categorize a money-IN feed line as a deposit from the given account. */
export async function categorizeTxnAsDeposit(
  transactionId: string,
  opts: {
    from_account_id: string; // the income/other account it's categorized to
    to_account_id: string; // the bank account the money landed in
    date: string;
    amount: number;
    description?: string;
  }
): Promise<void> {
  await booksPost(`/banktransactions/uncategorized/${transactionId}/categorize`, {
    transaction_type: "deposit",
    from_account_id: opts.from_account_id,
    to_account_id: opts.to_account_id,
    date: opts.date,
    amount: opts.amount,
    description: opts.description ?? "",
  });
}

/** Reverse a categorization — returns the feed line to Uncategorized. */
export async function uncategorizeTxn(transactionId: string): Promise<void> {
  await booksPost(`/banktransactions/${transactionId}/uncategorize`, {});
}

// ---- Books health snapshot (read-only) ------------------------------------

/**
 * Compile a read-only snapshot of the books for the CFO/worker to reason over.
 * Each source is fetched independently so one permission gap doesn't sink the
 * whole report. Returns a Markdown text block ready for prompt injection.
 */
export async function fetchBooksSnapshot(): Promise<string> {
  const errors: string[] = [];

  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[zoho-books] ${label} failed:`, msg);
      errors.push(`${label}: ${msg}`);
      return fallback;
    }
  };

  const empty = { items: [], total: 0 };
  const [accounts, uncategorized, invoices, bills] = await Promise.all([
    safe("Chart of Accounts", () => fetchPageWithTotal<BooksAccount>("/chartofaccounts", "chartofaccounts"), empty as { items: BooksAccount[]; total: number }),
    safe("Uncategorized transactions", () => fetchUncategorizedBankTxns(40), empty as { items: BooksBankTxn[]; total: number }),
    safe("Open invoices (A/R)", () => fetchPageWithTotal<BooksInvoice>("/invoices", "invoices", { status: "unpaid" }), empty as { items: BooksInvoice[]; total: number }),
    safe("Open bills (A/P)", () => fetchPageWithTotal<BooksBill>("/bills", "bills", { status: "unpaid" }), empty as { items: BooksBill[]; total: number }),
  ]);

  // If everything failed, surface a clear diagnostic rather than crashing.
  if (
    accounts.total === 0 &&
    uncategorized.total === 0 &&
    invoices.total === 0 &&
    bills.total === 0 &&
    errors.length > 0
  ) {
    return [
      "## ⚠️ Zoho Books Data Unavailable",
      "",
      "Could not retrieve data from Zoho Books via the REST fallback.",
      "Likely an expired/revoked refresh token or a missing Books scope.",
      "",
      "### Errors",
      ...errors.map((e) => `- ${e}`),
      "",
      "### Next Steps",
      "1. Confirm the ZOHO_REFRESH_TOKEN includes scope `ZohoBooks.fullaccess.all` (or read scopes).",
      "2. Regenerate it at https://api-console.zoho.com/ if needed.",
      "3. Or finish the Zoho Books MCP setup and set ZOHO_BOOKS_MCP_URL.",
    ].join("\n");
  }

  // Aggregate quick stats. Counts come from Zoho's reported total; dollar
  // figures are summed over the first-page sample (≤200 rows).
  const arTotal = invoices.items.reduce((s, i) => s + (i.balance || 0), 0);
  const apTotal = bills.items.reduce((s, b) => s + (b.balance || 0), 0);
  const overdueAR = invoices.items.filter((i) => i.status === "overdue").length;
  const inactiveAccounts = accounts.items.filter((a) => !a.is_active).length;

  const lines = [
    "## Zoho Books Snapshot (read-only)",
    `Chart of Accounts: ${accounts.total} accounts (${inactiveAccounts}+ inactive in sample)`,
    `Uncategorized bank transactions: ${uncategorized.total}`,
    `Open invoices (A/R): ${invoices.total} — $${arTotal.toFixed(2)}+ outstanding (sample), ${overdueAR}+ overdue`,
    `Open bills (A/P): ${bills.total} — $${apTotal.toFixed(2)}+ outstanding (sample)`,
    "",
  ];

  if (uncategorized.items.length > 0) {
    lines.push("### Uncategorized Transactions (sample, up to 40)");
    lines.push("| Date | Payee | Amount | Description |");
    lines.push("|------|-------|--------|-------------|");
    for (const t of uncategorized.items.slice(0, 40)) {
      lines.push(
        `| ${t.date} | ${t.payee ?? "—"} | $${(t.amount ?? 0).toFixed(2)} | ${(t.description ?? "").slice(0, 60)} |`
      );
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push("### ⚠️ Partial Data Notice");
    lines.push(...errors.map((e) => `- ${e}`));
    lines.push("");
  }

  return lines.join("\n");
}
