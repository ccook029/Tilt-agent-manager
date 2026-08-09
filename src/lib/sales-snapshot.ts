// ---------------------------------------------------------------------------
// sales-snapshot.ts — what actually sold, from Zoho Books invoices.
//
// Every order writes a Books invoice (createSalesInvoice), so invoices are the
// reliable record of sales — the same source the HQ dashboard metrics use.
// (Zoho Inventory sales orders are flakier, which is why Reese's inventory-based
// view said "nothing sold".) Cached like the other snapshots so it's fast.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { fetchInvoices, type ZohoInvoice } from "./zoho";

const KEY = "sales-snapshot";
const TTL_MS = 25 * 60 * 1000;
const HARD_TTL_MS = 90 * 60 * 1000;

interface Cached {
  text: string;
  builtAt: string;
}

function isStickSku(sku?: string): boolean {
  return !!sku && sku.toUpperCase().startsWith("TILT-");
}
function counts(inv: ZohoInvoice): boolean {
  const s = (inv.status || "").toLowerCase();
  return s !== "void" && s !== "draft";
}

export async function buildSalesSnapshotText(): Promise<string> {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const thirtyAgo = new Date(now);
  thirtyAgo.setDate(now.getDate() - 30);

  let invoices: ZohoInvoice[];
  try {
    invoices = await fetchInvoices(fmt(thirtyAgo), fmt(now));
  } catch (err) {
    return `## Sales (Zoho Books invoices)\n(Couldn't reach Zoho Books to read sales${err instanceof Error ? `: ${err.message}` : ""}.)`;
  }

  const valid = invoices.filter(counts);
  if (valid.length === 0) {
    return "## Sales (Zoho Books invoices)\nNo invoices recorded in the last 30 days.";
  }

  const rev = (arr: ZohoInvoice[]) => arr.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const sticks = (arr: ZohoInvoice[]) =>
    arr.reduce(
      (s, i) =>
        s +
        (i.line_items ?? [])
          .filter((li) => isStickSku(li.sku))
          .reduce((n, li) => n + (Number(li.quantity) || 0), 0),
      0
    );

  const wk = fmt(weekAgo);
  const thisWeek = valid.filter((i) => i.date >= wk);
  const thisMonth = valid.filter((i) => i.date >= monthStart);
  const recent = [...valid]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12)
    .map(
      (i) => `- ${i.date} — ${i.customer_name || "?"} (${i.invoice_number}): $${(Number(i.total) || 0).toFixed(2)}`
    )
    .join("\n");

  return [
    "## Sales — from Zoho Books invoices (the real record of what sold)",
    `Last 7 days: ${thisWeek.length} orders, $${rev(thisWeek).toFixed(2)}, ~${sticks(thisWeek)} sticks`,
    `This month (since ${monthStart}): ${thisMonth.length} orders, $${rev(thisMonth).toFixed(2)}, ~${sticks(thisMonth)} sticks`,
    `Last 30 days: ${valid.length} orders, $${rev(valid).toFixed(2)}`,
    "",
    "Recent orders (newest first):",
    recent,
  ].join("\n");
}

export async function refreshSalesSnapshot(): Promise<Cached> {
  const text = await buildSalesSnapshotText();
  const entry: Cached = { text, builtAt: new Date().toISOString() };
  try {
    await kv.set(KEY, entry);
  } catch {
    /* best-effort */
  }
  return entry;
}

export async function getCachedSalesSnapshot(): Promise<string> {
  let cached: Cached | null = null;
  try {
    cached = (await kv.get<Cached>(KEY)) ?? null;
  } catch {
    cached = null;
  }
  const age = cached ? Date.now() - new Date(cached.builtAt).getTime() : Infinity;
  if (!cached || age > HARD_TTL_MS) {
    return (await refreshSalesSnapshot()).text;
  }
  if (age > TTL_MS) void refreshSalesSnapshot();
  return cached.text;
}
