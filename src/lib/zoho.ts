// ---------------------------------------------------------------------------
// zoho.ts — Zoho Inventory API client
//
// Authenticates via OAuth 2.0 refresh token flow, pulls items, sales orders,
// and purchase orders from Zoho Inventory.
//
// Required env vars:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID
//
// Optional:
//   ZOHO_API_DOMAIN  (defaults to https://www.zohoapis.com)
//   ZOHO_ACCOUNTS_URL (defaults to https://accounts.zoho.com)
// ---------------------------------------------------------------------------

// ---- OAuth token cache ----------------------------------------------------

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function getEnvOrThrow(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} env var is not set`);
  return val;
}

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = getEnvOrThrow("ZOHO_CLIENT_ID");
  const clientSecret = getEnvOrThrow("ZOHO_CLIENT_SECRET");
  const refreshToken = getEnvOrThrow("ZOHO_REFRESH_TOKEN");
  const accountsUrl =
    process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com";

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch(`${accountsUrl}/oauth/v2/token?${params}`, {
    method: "POST",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoho OAuth token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    error?: string;
  };

  if (data.error) {
    throw new Error(`Zoho OAuth error: ${data.error}`);
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}

// ---- Generic API caller ---------------------------------------------------

async function zohoGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORG_ID");
  const domain = process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.com";

  const url = new URL(`${domain}/inventory/v1${path}`);
  url.searchParams.set("organization_id", orgId);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoho API ${path} failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

// ---- Zoho Inventory types (partial, relevant fields) ----------------------

export interface ZohoItem {
  item_id: string;
  name: string;
  sku: string;
  status: string;
  stock_on_hand: number;
  reorder_level: number;
  unit: string;
  rate: number;
  purchase_rate: number;
  group_name?: string;
  category_name?: string;
  vendor_name?: string;
  available_stock?: number;
}

interface ZohoItemsResponse {
  items: ZohoItem[];
  page_context: {
    page: number;
    per_page: number;
    has_more_page: boolean;
    total: number;
  };
}

export interface ZohoPurchaseOrder {
  purchaseorder_id: string;
  purchaseorder_number: string;
  vendor_name: string;
  status: string;
  order_status: string;
  total: number;
  date: string;
  expected_delivery_date: string;
  line_items: {
    item_id: string;
    name: string;
    sku: string;
    quantity: number;
    rate: number;
    quantity_received: number;
  }[];
}

interface ZohoPurchaseOrdersResponse {
  purchaseorders: ZohoPurchaseOrder[];
  page_context: {
    page: number;
    per_page: number;
    has_more_page: boolean;
    total: number;
  };
}

export interface ZohoSalesOrder {
  salesorder_id: string;
  salesorder_number: string;
  customer_name: string;
  status: string;
  total: number;
  date: string;
  line_items: {
    item_id: string;
    name: string;
    sku: string;
    quantity: number;
    rate: number;
  }[];
}

interface ZohoSalesOrdersResponse {
  salesorders: ZohoSalesOrder[];
  page_context: {
    page: number;
    per_page: number;
    has_more_page: boolean;
    total: number;
  };
}

// ---- Public API -----------------------------------------------------------

/** Fetch all active items (paginated, returns up to 200 per page). */
export async function fetchAllItems(): Promise<ZohoItem[]> {
  const allItems: ZohoItem[] = [];
  let page = 1;

  while (true) {
    const res = await zohoGet<ZohoItemsResponse>("/items", {
      page: String(page),
      per_page: "200",
      sort_column: "sku",
      sort_order: "A",
    });

    allItems.push(...res.items);

    if (!res.page_context.has_more_page) break;
    page++;
    // Safety limit — avoid runaway pagination
    if (page > 10) break;
  }

  return allItems;
}

/** Fetch recent purchase orders (last 90 days, open/partially received). */
export async function fetchOpenPurchaseOrders(): Promise<ZohoPurchaseOrder[]> {
  const res = await zohoGet<ZohoPurchaseOrdersResponse>("/purchaseorders", {
    status: "open,partially_received",
    per_page: "100",
    sort_column: "expected_delivery_date",
    sort_order: "A",
  });

  return res.purchaseorders ?? [];
}

/** Fetch sales orders from the last N days for velocity calculations. */
export async function fetchRecentSalesOrders(
  days: number = 30
): Promise<ZohoSalesOrder[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const allOrders: ZohoSalesOrder[] = [];
  let page = 1;

  while (true) {
    const res = await zohoGet<ZohoSalesOrdersResponse>("/salesorders", {
      page: String(page),
      per_page: "200",
      sort_column: "date",
      sort_order: "D",
      date_start: fmt(startDate),
      date_end: fmt(endDate),
    });

    allOrders.push(...(res.salesorders ?? []));

    if (!res.page_context?.has_more_page) break;
    page++;
    if (page > 10) break;
  }

  return allOrders;
}

// ---- Formatted output for prompt injection --------------------------------

/**
 * Fetch all Zoho data and format it as a text block for Claude.
 * Returns structured inventory snapshot + sales velocity + open POs.
 */
export async function fetchInventorySnapshot(): Promise<string> {
  const [items, salesOrders, purchaseOrders] = await Promise.all([
    fetchAllItems(),
    fetchRecentSalesOrders(30),
    fetchOpenPurchaseOrders(),
  ]);

  // Calculate 30-day sales velocity per SKU
  const velocityMap = new Map<string, number>();
  for (const order of salesOrders) {
    for (const li of order.line_items) {
      velocityMap.set(li.sku, (velocityMap.get(li.sku) ?? 0) + li.quantity);
    }
  }

  // Format items table
  const itemRows = items.map((item) => {
    const velocity = velocityMap.get(item.sku) ?? 0;
    const daysOfSupply =
      velocity > 0 ? Math.round((item.stock_on_hand / velocity) * 30) : 999;
    let status = "🟢 Healthy";
    if (item.stock_on_hand <= 0) {
      status = "🔴 OUT OF STOCK";
    } else if (item.reorder_level > 0 && item.stock_on_hand <= item.reorder_level) {
      status = "🔴 Critical";
    } else if (
      item.reorder_level > 0 &&
      item.stock_on_hand <= item.reorder_level * 1.2
    ) {
      status = "🟡 Watch";
    } else if (velocity === 0) {
      status = "⚪ No Movement";
    }

    return [
      item.sku || "(no SKU)",
      item.name,
      String(item.stock_on_hand),
      String(item.reorder_level),
      String(velocity),
      daysOfSupply === 999 ? "N/A" : String(daysOfSupply),
      status,
    ];
  });

  const itemsHeader = [
    "SKU",
    "Product Name",
    "Stock On Hand",
    "Reorder Level",
    "30-Day Sales",
    "Days of Supply",
    "Status",
  ];
  const itemsTable = formatTable(itemsHeader, itemRows);

  // Format open POs
  const poRows = purchaseOrders.map((po) => [
    po.purchaseorder_number,
    po.vendor_name,
    po.expected_delivery_date || "TBD",
    String(po.line_items.length) + " items",
    po.status,
    `$${po.total.toFixed(2)}`,
  ]);
  const poHeader = ["PO #", "Vendor", "Expected Delivery", "Items", "Status", "Total"];
  const poTable =
    poRows.length > 0
      ? formatTable(poHeader, poRows)
      : "(No open purchase orders)";

  // Summary stats
  const totalSKUs = items.length;
  const outOfStock = items.filter((i) => i.stock_on_hand <= 0).length;
  const critical = items.filter(
    (i) =>
      i.stock_on_hand > 0 &&
      i.reorder_level > 0 &&
      i.stock_on_hand <= i.reorder_level
  ).length;
  const watching = items.filter(
    (i) =>
      i.reorder_level > 0 &&
      i.stock_on_hand > i.reorder_level &&
      i.stock_on_hand <= i.reorder_level * 1.2
  ).length;
  const noMovement = items.filter(
    (i) => i.stock_on_hand > 0 && (velocityMap.get(i.sku) ?? 0) === 0
  ).length;
  const totalValue = items.reduce(
    (sum, i) => sum + i.stock_on_hand * i.rate,
    0
  );

  return [
    "## Inventory Summary",
    `Total Active SKUs: ${totalSKUs}`,
    `Out of Stock: ${outOfStock}`,
    `Critical (at/below reorder): ${critical}`,
    `Watch (approaching reorder): ${watching}`,
    `No Movement (30 days): ${noMovement}`,
    `Estimated Inventory Value: $${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Sales Orders (last 30 days): ${salesOrders.length}`,
    `Open Purchase Orders: ${purchaseOrders.length}`,
    "",
    "## Full Inventory Data",
    itemsTable,
    "",
    "## Open Purchase Orders",
    poTable,
  ].join("\n");
}

// ---- Helpers --------------------------------------------------------------

function formatTable(header: string[], rows: string[][]): string {
  const allRows = [header, ...rows];
  const colWidths = header.map((_, i) =>
    Math.max(...allRows.map((row) => (row[i] ?? "").length))
  );

  const pad = (str: string, width: number) => str.padEnd(width);
  const separator = colWidths.map((w) => "-".repeat(w)).join(" | ");

  const headerLine = header.map((h, i) => pad(h, colWidths[i])).join(" | ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => pad(cell, colWidths[i])).join(" | ")
  );

  return [headerLine, separator, ...dataLines].join("\n");
}
