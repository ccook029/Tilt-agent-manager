// ---------------------------------------------------------------------------
// zoho-sheet.ts — Zoho Sheet API client
//
// Reads product data from the Tilt master spreadsheet in Zoho Sheets.
// The sheet is the source of truth for all product/SKU data.
//
// Required env vars:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
//   ZOHO_SHEET_RESOURCE_ID  — the resource ID from the Zoho Sheet URL
//
// Optional:
//   ZOHO_SHEET_WORKSHEET_NAME — worksheet tab name (defaults to "Sheet1")
//   ZOHO_SHEET_DOMAIN          — Sheet API domain (defaults based on ZOHO_DOMAIN)
// ---------------------------------------------------------------------------

import { getAccessToken, getEnvOrThrow } from "./zoho";

// ---- Types ----------------------------------------------------------------

/** A row from the master inventory spreadsheet. Column names are normalized. */
export interface SheetRow {
  row_index: number;
  [column: string]: string | number;
}

/** Parsed product record from the sheet with expected columns. */
export interface SheetProduct {
  row_index: number;
  sku: string;
  name: string;
  rate: number;
  purchase_rate: number;
  reorder_level: number;
  unit: string;
  category: string;
  description: string;
  level: string;
  carbon: string;
  /** Raw row data for any extra columns */
  raw: Record<string, string | number>;
}

// ---- Zoho Sheet API -------------------------------------------------------

/**
 * Derive the Sheet API base URL. Order of precedence:
 *  1. ZOHO_SHEET_DOMAIN env var (explicit override)
 *  2. Inferred from ZOHO_DOMAIN (e.g. zohoapis.eu → sheet.zoho.eu)
 *  3. Default: https://sheet.zoho.com
 */
function getSheetApiBase(): string {
  if (process.env.ZOHO_SHEET_DOMAIN) {
    return process.env.ZOHO_SHEET_DOMAIN.replace(/\/+$/, "") + "/api/v2";
  }

  const zohoDomain = process.env.ZOHO_DOMAIN ?? "";
  if (zohoDomain.includes(".zoho.eu") || zohoDomain.includes("zohoapis.eu")) {
    return "https://sheet.zoho.eu/api/v2";
  }
  if (zohoDomain.includes(".zoho.in") || zohoDomain.includes("zohoapis.in")) {
    return "https://sheet.zoho.in/api/v2";
  }
  if (zohoDomain.includes(".zoho.com.au") || zohoDomain.includes("zohoapis.com.au")) {
    return "https://sheet.zoho.com.au/api/v2";
  }
  if (zohoDomain.includes(".zoho.jp") || zohoDomain.includes("zohoapis.jp")) {
    return "https://sheet.zoho.jp/api/v2";
  }

  return "https://sheet.zoho.com/api/v2";
}

/**
 * Fetch all rows from the master inventory worksheet.
 * Zoho Sheet API limits to 1000 rows per call, so we paginate.
 */
export async function fetchSheetRows(): Promise<SheetRow[]> {
  const resourceId = getEnvOrThrow("ZOHO_SHEET_RESOURCE_ID");
  const worksheetName =
    process.env.ZOHO_SHEET_WORKSHEET_NAME ?? "Sheet1";
  const token = await getAccessToken();

  const allRows: SheetRow[] = [];
  let startIndex = 1;
  const batchSize = 1000;

  while (true) {
    const sheetBase = getSheetApiBase();
    const url = new URL(`${sheetBase}/${resourceId}`);
    url.searchParams.set("method", "worksheet.records.fetch");
    url.searchParams.set("worksheet_name", worksheetName);
    url.searchParams.set("records_start_index", String(startIndex));
    url.searchParams.set("count", String(batchSize));

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Zoho Sheet API failed (${res.status}) at ${sheetBase}: ${body}. ` +
          "Check ZOHO_SHEET_RESOURCE_ID and ensure the refresh token has ZohoSheet.dataAPI.READ scope. " +
          "If using a regional Zoho (EU/IN/AU), set ZOHO_SHEET_DOMAIN to the correct Sheet URL."
      );
    }

    const data = (await res.json()) as {
      method: string;
      status: string;
      records: SheetRow[];
      error_message?: string;
    };

    if (data.error_message) {
      throw new Error(`Zoho Sheet API error: ${data.error_message}`);
    }

    const records = data.records ?? [];
    if (records.length === 0) break;

    allRows.push(...records);

    // If we got fewer than the batch size, we've reached the end
    if (records.length < batchSize) break;
    startIndex += batchSize;

    // Safety limit
    if (startIndex > 10_000) break;
  }

  return allRows;
}

// ---- Column name mapping --------------------------------------------------

// The sheet may have various column header names. We normalize them to
// a standard set. Add mappings here as the sheet evolves.
const COLUMN_MAP: Record<string, keyof SheetProduct> = {
  // SKU variations
  sku: "sku",
  "sku #": "sku",
  "sku number": "sku",
  "item sku": "sku",
  "product sku": "sku",

  // Name variations
  name: "name",
  "product name": "name",
  "item name": "name",
  product: "name",
  title: "name",

  // Rate / price variations
  rate: "rate",
  price: "rate",
  "selling price": "rate",
  "sales price": "rate",
  "retail price": "rate",

  // Purchase rate
  "purchase rate": "purchase_rate",
  "purchase price": "purchase_rate",
  cost: "purchase_rate",
  "unit cost": "purchase_rate",

  // Reorder level
  "reorder level": "reorder_level",
  "reorder point": "reorder_level",
  "reorder qty": "reorder_level",
  "min stock": "reorder_level",

  // Unit
  unit: "unit",
  uom: "unit",
  "unit of measure": "unit",

  // Category
  category: "category",
  "category name": "category",
  type: "category",
  "product type": "category",

  // Description
  description: "description",
  desc: "description",
  details: "description",

  // Stick-specific: level (JR, INT, SR, Goalie)
  level: "level",
  "stick level": "level",
  "player level": "level",
  size: "level",

  // Stick-specific: carbon weave (18k, 24k, etc.)
  carbon: "carbon",
  "carbon weave": "carbon",
  weave: "carbon",
  "carbon type": "carbon",
};

function normalizeColumnName(col: string): keyof SheetProduct | null {
  const lower = col.toLowerCase().trim();
  return COLUMN_MAP[lower] ?? null;
}

// ---- Parse sheet rows into products ---------------------------------------

/**
 * Fetch and parse the master spreadsheet into typed product records.
 * Skips rows missing a SKU.
 */
export async function fetchSheetProducts(): Promise<SheetProduct[]> {
  const rows = await fetchSheetRows();
  const products: SheetProduct[] = [];

  for (const row of rows) {
    const product: SheetProduct = {
      row_index: row.row_index,
      sku: "",
      name: "",
      rate: 0,
      purchase_rate: 0,
      reorder_level: 0,
      unit: "qty",
      category: "",
      description: "",
      level: "",
      carbon: "",
      raw: {},
    };

    for (const [col, val] of Object.entries(row)) {
      if (col === "row_index") continue;

      // Store raw value
      product.raw[col] = val;

      const mapped = normalizeColumnName(col);
      if (!mapped || mapped === "raw" || mapped === "row_index") continue;

      if (mapped === "rate" || mapped === "purchase_rate" || mapped === "reorder_level") {
        product[mapped] = typeof val === "number" ? val : parseFloat(String(val)) || 0;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (product as any)[mapped] = String(val).trim();
      }
    }

    // Skip rows without a SKU — they're probably header/blank rows
    if (!product.sku) continue;

    products.push(product);
  }

  return products;
}

// ---- Formatted output for prompt injection --------------------------------

/**
 * Fetch sheet data and format as a text block for Claude.
 */
export async function fetchSheetSnapshot(): Promise<string> {
  try {
    const products = await fetchSheetProducts();

    if (products.length === 0) {
      return [
        "## ⚠️ Zoho Sheet Data Empty",
        "",
        "No product rows found in the master spreadsheet.",
        "Check that ZOHO_SHEET_RESOURCE_ID and ZOHO_SHEET_WORKSHEET_NAME are correct.",
      ].join("\n");
    }

    const header = ["SKU", "Product Name", "Level", "Carbon", "Rate", "Purchase Rate", "Reorder Level", "Unit", "Category"];
    const rows = products.map((p) => [
      p.sku,
      p.name,
      p.level || "-",
      p.carbon || "-",
      p.rate ? `$${p.rate.toFixed(2)}` : "-",
      p.purchase_rate ? `$${p.purchase_rate.toFixed(2)}` : "-",
      String(p.reorder_level || "-"),
      p.unit || "qty",
      p.category || "-",
    ]);

    const table = formatSheetTable(header, rows);

    return [
      "## Master Spreadsheet (Source of Truth)",
      `Total Products: ${products.length}`,
      "",
      table,
    ].join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      "## ⚠️ Zoho Sheet Data Unavailable",
      "",
      `Error: ${msg}`,
      "",
      "Ensure the refresh token has scope: ZohoSheet.dataAPI.READ",
    ].join("\n");
  }
}

function formatSheetTable(header: string[], rows: string[][]): string {
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
