// ---------------------------------------------------------------------------
// sales/retailers.ts — the consignment-billing feed for the Retailer Auditor.
//
// Consignment retailers are invoiced monthly (wholesale = MSRP − 30%) in the
// first week of the following month, due the 15th. tiltweb computes the
// billable months per retailer; this pulls them so the auditor can cross-check
// against Zoho Books and flag any month that wasn't invoiced.
//
// Backed by tiltweb GET /api/modules/consignment. Degrades to a note until
// that endpoint is deployed.
// ---------------------------------------------------------------------------
import { getModule } from "./tiltweb-feed";

export interface BillableMonth {
  month: string; // "YYYY-MM"
  count: number;
  wholesale_total: number;
  invoice_month: string; // "YYYY-MM" it should be invoiced in
  due_date: string; // "YYYY-MM-DD"
}

export interface ConsignmentAccount {
  id: string;
  name: string;
  account_type: string;
  aliases?: string[];
  billable_months: BillableMonth[];
}

export async function fetchConsignmentAccounts(): Promise<
  { accounts: ConsignmentAccount[] } | { error: string }
> {
  const res = await getModule<{ ok?: boolean; accounts?: ConsignmentAccount[] }>(
    "/api/modules/consignment"
  );
  if ("error" in res) return res;
  return { accounts: Array.isArray(res.data.accounts) ? res.data.accounts : [] };
}

/** Billable months per consignment retailer, for the auditor to cross-check. */
export async function renderConsignmentSnapshot(): Promise<string> {
  const res = await fetchConsignmentAccounts();
  if ("error" in res) {
    return `(consignment feed not available this run: ${res.error}. When wired, this lists each consignment retailer's billable months and when each should be invoiced.)`;
  }
  const withSales = res.accounts.filter((a) => a.billable_months.length > 0);
  if (withSales.length === 0)
    return "(no consignment retailers have billable sales on file right now)";

  return withSales
    .map((a) => {
      const names = [a.name, ...(a.aliases ?? [])].join(" / ");
      const months = a.billable_months
        .map(
          (m) =>
            `  - ${m.month}: ${m.count} stick(s), $${m.wholesale_total.toFixed(
              2
            )} wholesale → invoice in ${m.invoice_month}, due ${m.due_date}`
        )
        .join("\n");
      return `${names} [${a.account_type}]\n${months}`;
    })
    .join("\n\n");
}
