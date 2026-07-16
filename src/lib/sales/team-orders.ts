// ---------------------------------------------------------------------------
// sales/team-orders.ts — the team-store order feed for the Team Sales Coordinator.
//
// Going forward, whole-team orders come through the tiltweb team store
// (tilthockey.com/team): a batch order for a roster, invoiced to the team
// (50% deposit, Net-30 balance). This pulls the open orders + line items so the
// coordinator can consolidate a team's gear and route it to the right vendors.
//
// Backed by tiltweb GET /api/modules/team-orders (to be deployed there). Until
// then getModule() returns a graceful note and the snapshot says so.
// ---------------------------------------------------------------------------
import { getModule } from "./tiltweb-feed";

export interface TeamOrderItem {
  product_name: string;
  options?: Record<string, unknown> | null;
  player_name?: string | null;
  player_number?: string | null;
  quantity: number;
  unit_price?: number | null;
  line_total?: number | null;
}

export interface TeamOrder {
  order_number: string;
  team_name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  status?: string | null;
  subtotal?: number | null;
  deposit_amount?: number | null;
  balance_due?: number | null;
  created_at?: string | null;
  items: TeamOrderItem[];
}

export async function fetchTeamOrders(): Promise<
  { orders: TeamOrder[] } | { error: string }
> {
  const res = await getModule<{ ok?: boolean; orders?: TeamOrder[] }>(
    "/api/modules/team-orders"
  );
  if ("error" in res) return res;
  const orders = Array.isArray(res.data.orders) ? res.data.orders : [];
  return { orders };
}

/** A readable snapshot of open team orders for the coordinator's context. */
export async function renderTeamOrdersSnapshot(): Promise<string> {
  const res = await fetchTeamOrders();
  if ("error" in res) {
    return `(team-store orders not available this run: ${res.error}. When wired, this shows each open team order and its line items to consolidate.)`;
  }
  if (res.orders.length === 0) return "(no open team orders in the portal right now)";

  return res.orders
    .map((o) => {
      const head = `TEAM ORDER ${o.order_number}${o.team_name ? ` — ${o.team_name}` : ""}${
        o.status ? ` [${o.status}]` : ""
      }${o.contact_email ? ` · contact ${o.contact_name ?? ""} <${o.contact_email}>` : ""}`;
      const lines = o.items
        .map((it) => {
          const opts = it.options
            ? " " +
              Object.entries(it.options)
                .map(([k, v]) => `${k}:${v}`)
                .join(" ")
            : "";
          const who =
            it.player_name || it.player_number
              ? ` (${[it.player_name, it.player_number].filter(Boolean).join(" #")})`
              : "";
          return `  - ${it.quantity} × ${it.product_name}${opts}${who}`;
        })
        .join("\n");
      return `${head}\n${lines}`;
    })
    .join("\n\n");
}
