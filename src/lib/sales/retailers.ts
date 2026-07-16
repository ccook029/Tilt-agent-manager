// ---------------------------------------------------------------------------
// sales/retailers.ts — the retailer/consignment feed for the Retailer Auditor.
//
// Retailer accounts (wholesale + consignment) live in the tiltweb retailer
// portal (/admin/retailers). The Retailer Account Auditor tracks orders through
// the portal and makes sure consignment accounts get invoiced. This pulls the
// accounts + their orders + invoice status so the auditor can flag gaps.
//
// Backed by tiltweb GET /api/modules/retailers (to be deployed there). Until
// then getModule() returns a graceful note.
// ---------------------------------------------------------------------------
import { getModule } from "./tiltweb-feed";

export interface RetailerOrder {
  order_number?: string | null;
  placed_at?: string | null;
  total?: number | null;
  /** Whether an invoice has been raised for this order. */
  invoiced?: boolean | null;
  invoice_number?: string | null;
}

export interface RetailerAccount {
  name: string;
  /** "wholesale" | "consignment" — how the account is billed. */
  type?: string | null;
  contact_email?: string | null;
  status?: string | null;
  orders?: RetailerOrder[];
}

export async function fetchRetailers(): Promise<
  { accounts: RetailerAccount[] } | { error: string }
> {
  const res = await getModule<{ ok?: boolean; accounts?: RetailerAccount[] }>(
    "/api/modules/retailers"
  );
  if ("error" in res) return res;
  const accounts = Array.isArray(res.data.accounts) ? res.data.accounts : [];
  return { accounts };
}

function isConsignment(a: RetailerAccount): boolean {
  return (a.type ?? "").toLowerCase().includes("consign");
}

/** Snapshot for the auditor: accounts, consignment flag, and un-invoiced orders. */
export async function renderRetailersSnapshot(): Promise<string> {
  const res = await fetchRetailers();
  if ("error" in res) {
    return `(retailer portal not available this run: ${res.error}. When wired, this lists retailer accounts, which are consignment, and which orders still need an invoice.)`;
  }
  if (res.accounts.length === 0) return "(no retailer accounts on file right now)";

  const blocks = res.accounts.map((a) => {
    const orders = a.orders ?? [];
    const uninvoiced = orders.filter((o) => o.invoiced === false);
    const tag = isConsignment(a) ? "CONSIGNMENT" : a.type ?? "account";
    const head = `${a.name} [${tag}]${a.status ? ` · ${a.status}` : ""}${
      a.contact_email ? ` · ${a.contact_email}` : ""
    }`;
    const flag =
      isConsignment(a) && uninvoiced.length > 0
        ? `\n  ⚠ ${uninvoiced.length} order(s) with NO invoice: ${uninvoiced
            .map((o) => o.order_number ?? "(unnumbered)")
            .join(", ")}`
        : orders.length > 0
          ? `\n  ${orders.length} order(s), all invoiced`
          : "\n  no orders on file";
    return `- ${head}${flag}`;
  });
  return blocks.join("\n");
}
