// ---------------------------------------------------------------------------
// sales/invoices.ts — recent Zoho Books invoices, for the Retailer Auditor to
// cross-reference against consignment billable months.
//
// The auditor answers "was this consignment month actually invoiced?" by
// matching a retailer + month + wholesale amount against the real invoices in
// Zoho Books (the same connection Penny/Sterling use). Best-effort: if Zoho
// isn't configured this run, it degrades to a note.
// ---------------------------------------------------------------------------
import { fetchRecentInvoices } from "../zoho-books";

/** ~4 months of invoices, so recent consignment billing periods are covered. */
const LOOKBACK_DAYS = 120;

export async function renderRecentInvoicesSnapshot(): Promise<string> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  try {
    const invoices = await fetchRecentInvoices(since);
    if (!invoices || invoices.length === 0) {
      return `(no invoices in Zoho Books since ${since} — so nothing has been invoiced recently, or Zoho returned none)`;
    }
    const lines = invoices
      .slice(0, 100)
      .map(
        (i) =>
          `- ${i.date} · ${i.customer_name} · ${i.invoice_number} · $${(
            i.total ?? 0
          ).toFixed(2)} · ${i.status}`
      )
      .join("\n");
    return `Invoices in Zoho Books since ${since}:\n${lines}`;
  } catch (e) {
    return `(Zoho Books invoices unavailable this run: ${
      e instanceof Error ? e.message : e
    })`;
  }
}
