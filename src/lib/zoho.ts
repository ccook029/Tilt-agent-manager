// ---------------------------------------------------------------------------
// zoho.ts — Zoho Inventory API client
//
// Authenticates via OAuth 2.0 refresh token flow, pulls items, sales orders,
// and purchase orders from Zoho Inventory. Also supports creating and
// updating items to keep Zoho Inventory in sync with the master spreadsheet.
//
// Required env vars:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID
//
// Optional:
//   ZOHO_DOMAIN       (defaults to https://www.zohoapis.com)
//   ZOHO_ACCOUNTS_URL (defaults to https://accounts.zoho.com)
// ---------------------------------------------------------------------------

// ---- OAuth token cache ----------------------------------------------------
//
// Zoho rate-limits the token-refresh endpoint hard ("you have made too many
// requests"). To avoid tripping it we cache the access token in THREE layers:
//   1. In-memory (fast path within a warm serverless instance).
//   2. A single in-flight promise so concurrent callers (e.g. 4 parallel Books
//      fetches on a cold start) share ONE refresh instead of firing four.
//   3. Vercel KV, so the ~1-hour access token is shared across serverless
//      invocations and we refresh roughly once per hour for the whole app,
//      not once per cold start.
import { kv } from "@vercel/kv";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_CACHE_KEY = "zoho-access-token-cache";

let cachedToken: CachedToken | null = null;
let inflight: Promise<string> | null = null;

export function getEnvOrThrow(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} env var is not set`);
  return val;
}

function isValid(tok: CachedToken | null): tok is CachedToken {
  return !!tok && Date.now() < tok.expiresAt - 60_000; // 60s safety buffer
}

/** Clear the cached access token everywhere (call after a 401/403). */
export async function invalidateTokenCache(): Promise<void> {
  cachedToken = null;
  try {
    await kv.del(TOKEN_CACHE_KEY);
  } catch {
    /* KV optional — ignore */
  }
}

export async function getAccessToken(): Promise<string> {
  if (isValid(cachedToken)) return cachedToken.accessToken;
  // Collapse concurrent callers onto a single refresh.
  if (inflight) return inflight;
  inflight = acquireToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function acquireToken(): Promise<string> {
  // Shared cross-invocation cache (survives serverless cold starts).
  try {
    const kvTok = await kv.get<CachedToken>(TOKEN_CACHE_KEY);
    if (isValid(kvTok)) {
      cachedToken = kvTok;
      return kvTok.accessToken;
    }
  } catch {
    /* KV optional — fall through to a live refresh */
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
    cachedToken = null;
    throw new Error(
      `Zoho OAuth token refresh failed (${res.status}): ${body}. ` +
        "The refresh token may be expired or revoked — regenerate it in the Zoho API Console."
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    error?: string;
  };

  if (data.error) {
    cachedToken = null;
    throw new Error(
      `Zoho OAuth error: ${data.error}. ` +
        "The refresh token may be expired or revoked — regenerate it in the Zoho API Console."
    );
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  try {
    await kv.set(TOKEN_CACHE_KEY, cachedToken);
  } catch {
    /* KV optional — in-memory cache still applies */
  }

  return cachedToken.accessToken;
}

// ---- Generic API caller ---------------------------------------------------

async function zohoGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";

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
    // Invalidate token cache on auth failures so next call attempts a fresh token
    if (res.status === 401 || res.status === 403) {
      await invalidateTokenCache();
    }
    throw new Error(`Zoho API ${path} failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

// ---- Zoho Books API helper ------------------------------------------------

async function zohoBooks<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";

  const url = new URL(`${domain}/books/v3${path}`);
  url.searchParams.set("organization_id", orgId);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
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

// ---- Zoho Books: Paid Invoices -------------------------------------------

export interface ZohoInvoice {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  status: string;
  total: number;
  date: string; // YYYY-MM-DD
  line_items: {
    item_id: string;
    name: string;
    sku: string;
    quantity: number;
    rate: number;
  }[];
}

interface ZohoInvoicesResponse {
  invoices: ZohoInvoice[];
  page_context: {
    page: number;
    per_page: number;
    has_more_page: boolean;
    total: number;
  };
}

/**
 * Fetch invoices from Zoho Inventory for a given date range.
 * Excludes void and draft invoices.
 */
export async function fetchInvoices(
  startDate: string,
  endDate: string
): Promise<ZohoInvoice[]> {
  const allInvoices: ZohoInvoice[] = [];
  let page = 1;

  while (true) {
    const res = await zohoGet<ZohoInvoicesResponse>("/invoices", {
      page: String(page),
      per_page: "200",
      date_start: startDate,
      date_end: endDate,
      sort_column: "date",
      sort_order: "D",
    });

    allInvoices.push(...(res.invoices ?? []));

    if (!res.page_context?.has_more_page) break;
    page++;
    if (page > 10) break;
  }

  // Exclude void and draft — keep sent, paid, overdue, partially_paid, etc.
  return allInvoices.filter(
    (inv) => inv.status !== "void" && inv.status !== "draft"
  );
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
  description?: string;
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
  // Fetch open and partially received POs separately (Zoho doesn't accept comma-separated status)
  const [openRes, partialRes] = await Promise.all([
    zohoGet<ZohoPurchaseOrdersResponse>("/purchaseorders", {
      status: "open",
      per_page: "100",
      sort_column: "date",
      sort_order: "D",
    }),
    zohoGet<ZohoPurchaseOrdersResponse>("/purchaseorders", {
      status: "partially_received",
      per_page: "100",
      sort_column: "date",
      sort_order: "D",
    }),
  ]);

  return [
    ...(openRes.purchaseorders ?? []),
    ...(partialRes.purchaseorders ?? []),
  ];
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
  // Each data source is fetched independently so a single permission issue
  // doesn't take down the whole pipeline.
  const errors: string[] = [];

  let items: ZohoItem[] = [];
  try {
    items = await fetchAllItems();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[zoho] Could not fetch items:", msg);
    errors.push(`Items: ${msg}`);
  }

  let salesOrders: ZohoSalesOrder[] = [];
  try {
    salesOrders = await fetchRecentSalesOrders(30);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[zoho] Could not fetch sales orders:", msg);
    errors.push(`Sales Orders: ${msg}`);
  }

  let purchaseOrders: ZohoPurchaseOrder[] = [];
  try {
    purchaseOrders = await fetchOpenPurchaseOrders();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[zoho] Could not fetch purchase orders:", msg);
    errors.push(`Purchase Orders: ${msg}`);
  }

  // If we couldn't fetch ANY data, return a clear diagnostic instead of crashing
  if (items.length === 0 && errors.length > 0) {
    return [
      "## ⚠️ Zoho Inventory Data Unavailable",
      "",
      "The agent could not retrieve data from Zoho Inventory.",
      "This is likely caused by an expired or revoked refresh token.",
      "",
      "### Errors",
      ...errors.map((e) => `- ${e}`),
      "",
      "### Next Steps",
      "1. Go to the Zoho API Console (https://api-console.zoho.com/)",
      "2. Select your Self Client or Server-based Application",
      "3. Generate a new authorization code with scope: `ZohoInventory.fullaccess.all,ZohoSheet.dataAPI.READ`",
      "4. Exchange it for a new refresh token",
      "5. Update the ZOHO_REFRESH_TOKEN environment variable in Vercel",
    ].join("\n");
  }

  // Calculate 30-day sales velocity per SKU
  const velocityMap = new Map<string, number>();
  for (const order of salesOrders) {
    for (const li of order.line_items ?? []) {
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
    String((po.line_items ?? []).length) + " items",
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

// ---- Zoho Inventory write operations --------------------------------------

async function zohoPost<T>(
  path: string,
  body: Record<string, unknown>,
  params?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";

  const url = new URL(`${domain}/inventory/v1${path}`);
  url.searchParams.set("organization_id", orgId);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

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
    throw new Error(`Zoho API POST ${path} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

async function zohoPut<T>(
  path: string,
  body: Record<string, unknown>,
  params?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();
  const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";

  const url = new URL(`${domain}/inventory/v1${path}`);
  url.searchParams.set("organization_id", orgId);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) await invalidateTokenCache();
    throw new Error(`Zoho API PUT ${path} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

/** Create a new item in Zoho Inventory. */
export async function createInventoryItem(item: {
  name: string;
  sku: string;
  rate?: number;
  purchase_rate?: number;
  reorder_level?: number;
  unit?: string;
  description?: string;
  item_type?: string;
  product_type?: string;
}): Promise<ZohoItem> {
  const res = await zohoPost<{ item: ZohoItem }>("/items", {
    name: item.name,
    sku: item.sku,
    rate: item.rate ?? 0,
    purchase_rate: item.purchase_rate ?? 0,
    reorder_level: item.reorder_level ?? 0,
    unit: item.unit ?? "qty",
    description: item.description ?? "",
    item_type: item.item_type ?? "inventory",
    product_type: item.product_type ?? "goods",
  });
  return res.item;
}

/** Update an existing item in Zoho Inventory. */
export async function updateInventoryItem(
  itemId: string,
  updates: {
    name?: string;
    sku?: string;
    rate?: number;
    purchase_rate?: number;
    reorder_level?: number;
    unit?: string;
    description?: string;
  }
): Promise<ZohoItem> {
  // Only send fields that are provided
  const body: Record<string, unknown> = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.sku !== undefined) body.sku = updates.sku;
  if (updates.rate !== undefined) body.rate = updates.rate;
  if (updates.purchase_rate !== undefined) body.purchase_rate = updates.purchase_rate;
  if (updates.reorder_level !== undefined) body.reorder_level = updates.reorder_level;
  if (updates.unit !== undefined) body.unit = updates.unit;
  if (updates.description !== undefined) body.description = updates.description;

  const res = await zohoPut<{ item: ZohoItem }>(`/items/${itemId}`, body);
  return res.item;
}

// ---- Inventory Adjustments ------------------------------------------------

export interface AdjustmentLineItem {
  item_id: string;
  quantity_adjusted: number;
}

export interface InventoryAdjustmentResult {
  inventory_adjustment_id: string;
  inventory_adjustment_number: string;
  date: string;
  reason: string;
  line_items: {
    item_id: string;
    quantity_adjusted: number;
  }[];
}

/**
 * Create an inventory adjustment in Zoho Inventory.
 * Used to correct stock_on_hand to match the master spreadsheet.
 *
 * Each line item specifies an item_id and quantity_adjusted:
 *  - Positive = increase stock (under-counted in Inventory)
 *  - Negative = decrease stock (over-counted in Inventory)
 */
export async function createInventoryAdjustment(opts: {
  date: string;
  reason: string;
  line_items: AdjustmentLineItem[];
}): Promise<InventoryAdjustmentResult> {
  const res = await zohoPost<{ inventory_adjustment: InventoryAdjustmentResult }>(
    "/inventoryadjustments",
    {
      date: opts.date,
      reason: opts.reason,
      adjustment_type: "quantity",
      line_items: opts.line_items,
    }
  );
  return res.inventory_adjustment;
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
