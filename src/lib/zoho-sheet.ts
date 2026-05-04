// ---------------------------------------------------------------------------
// zoho-sheet.ts — Zoho Sheet API client
//
// Reads stick-level inventory data from the Tilt master spreadsheet.
// The spreadsheet tracks INDIVIDUAL sticks by serial number across
// multiple tabs (Player, Goalie). Each row = one physical stick.
//
// The reconciliation groups sticks by Level + Carbon to produce
// stock counts that can be compared against Zoho Inventory SKUs.
//
// Required env vars:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
//   ZOHO_SHEET_RESOURCE_ID  — the resource ID from the Zoho Sheet URL
//
// Optional:
//   ZOHO_SHEET_DOMAIN — Sheet API domain (defaults based on ZOHO_DOMAIN)
// ---------------------------------------------------------------------------

import { getAccessToken, getEnvOrThrow } from "./zoho";

// ---- Types ----------------------------------------------------------------

/** Raw row from the Zoho Sheet API. Column names are as-is from the sheet. */
export interface SheetRow {
  row_index: number;
  [column: string]: string | number;
}

/** A single stick record parsed from the spreadsheet. */
export interface StickRecord {
  row_index: number;
  tab: string;
  level: string;
  size: number;
  carbon: string;
  kick_point: string;
  hand: string;
  flex: number;
  curve: string;
  base_color: string;
  decal_color: string;
  serial_number: string;
  status: string;
  date_sold: string;
}

/**
 * Aggregated stock count for a Level + Carbon combination.
 * This is what gets compared against Zoho Inventory SKUs.
 */
export interface StockGroup {
  level: string;
  carbon: string;
  /** Grouping key used for matching: e.g. "INTERMEDIATE|18K" */
  groupKey: string;
  /** Count of sticks with Status = "Available" */
  available: number;
  /** Count of sticks with Status = "Sold" */
  sold: number;
  /** Total sticks in this group (all statuses) */
  total: number;
  /** Serial numbers of available sticks */
  availableSerials: string[];
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

/** Tabs to read for inventory counts. */
const INVENTORY_TABS = ["Player", "Goalie"];

/** Tabs that hold custom/special-order sticks. */
const CUSTOM_TABS = ["Custom Player Sticks", "Custom Goalie Sticks"];

/**
 * Fetch all rows from a specific worksheet tab.
 * Zoho Sheet API limits to 1000 rows per call, so we paginate.
 */
export async function fetchSheetRows(worksheetName: string): Promise<SheetRow[]> {
  const resourceId = getEnvOrThrow("ZOHO_SHEET_RESOURCE_ID");
  const token = await getAccessToken();
  const sheetBase = getSheetApiBase();

  const allRows: SheetRow[] = [];
  let startIndex = 1;
  const batchSize = 1000;

  while (true) {
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
        `Zoho Sheet API failed (${res.status}) for tab "${worksheetName}" at ${sheetBase}: ${body}. ` +
          "Check ZOHO_SHEET_RESOURCE_ID and ensure the refresh token has ZohoSheet.dataAPI.READ scope."
      );
    }

    const data = (await res.json()) as {
      method: string;
      status: string;
      records: SheetRow[];
      error_message?: string;
    };

    if (data.error_message) {
      throw new Error(`Zoho Sheet API error for tab "${worksheetName}": ${data.error_message}`);
    }

    const records = data.records ?? [];
    if (records.length === 0) break;

    allRows.push(...records);

    if (records.length < batchSize) break;
    startIndex += batchSize;

    // Safety limit
    if (startIndex > 10_000) break;
  }

  return allRows;
}

// ---- Column name normalization --------------------------------------------

/** Map of possible column header names to our standard field names. */
const COLUMN_MAP: Record<string, keyof StickRecord> = {
  level: "level",
  "size (inches)": "size",
  "size (inch)": "size",
  "size": "size",
  carbon: "carbon",
  "kick point": "kick_point",
  "kickpoint": "kick_point",
  hand: "hand",
  flex: "flex",
  curve: "curve",
  "base color": "base_color",
  "base colour": "base_color",
  "decal color": "decal_color",
  "decal colour": "decal_color",
  "serial number": "serial_number",
  "serial": "serial_number",
  "serial #": "serial_number",
  "sku": "serial_number",           // Goalie tab uses "SKU" as the stick identifier
  status: "status",
  "date sold": "date_sold",
  "sold date": "date_sold",
  "paddle": "size",                 // Goalie tab: paddle size (inches)
  "graphic color": "decal_color",   // Goalie tab: graphic color → decal_color
};

function normalizeColumn(col: string): keyof StickRecord | null {
  const lower = col.toLowerCase().trim();
  return COLUMN_MAP[lower] ?? null;
}

// ---- Parse sheet rows into stick records ----------------------------------

/**
 * Parse raw sheet rows into typed StickRecord objects.
 * Skips rows without a serial number (blank/header rows).
 */
function parseStickRecords(rows: SheetRow[], tab: string): StickRecord[] {
  const sticks: StickRecord[] = [];

  for (const row of rows) {
    const stick: StickRecord = {
      row_index: row.row_index,
      tab,
      level: "",
      size: 0,
      carbon: "",
      kick_point: "",
      hand: "",
      flex: 0,
      curve: "",
      base_color: "",
      decal_color: "",
      serial_number: "",
      status: "",
      date_sold: "",
    };

    for (const [col, val] of Object.entries(row)) {
      if (col === "row_index") continue;

      const mapped = normalizeColumn(col);
      if (!mapped) continue;

      if (mapped === "size" || mapped === "flex") {
        stick[mapped] = typeof val === "number" ? val : parseFloat(String(val)) || 0;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stick as any)[mapped] = String(val).trim();
      }
    }

    // Skip rows without a serial number — blank or header rows
    if (!stick.serial_number) continue;

    sticks.push(stick);
  }

  return sticks;
}

// ---- Fetch all stick records from Player + Goalie tabs --------------------

/**
 * Fetch and parse stick records from both the Player and Goalie tabs.
 */
export async function fetchAllStickRecords(): Promise<StickRecord[]> {
  const allSticks: StickRecord[] = [];

  for (const tab of INVENTORY_TABS) {
    try {
      const rows = await fetchSheetRows(tab);
      const sticks = parseStickRecords(rows, tab);
      allSticks.push(...sticks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[zoho-sheet] Failed to read tab "${tab}":`, msg);
      throw new Error(`Failed to read "${tab}" tab: ${msg}`);
    }
  }

  return allSticks;
}

/**
 * Fetch and parse stick records from the Custom Player Sticks and Custom Goalie Sticks tabs.
 * These represent custom/special orders that need to be included in factory orders.
 */
export async function fetchCustomStickRecords(): Promise<StickRecord[]> {
  const allSticks: StickRecord[] = [];

  for (const tab of CUSTOM_TABS) {
    try {
      const rows = await fetchSheetRows(tab);
      const sticks = parseStickRecords(rows, tab);
      allSticks.push(...sticks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Custom tabs may not exist yet — warn but don't throw
      console.warn(`[zoho-sheet] Could not read tab "${tab}":`, msg);
    }
  }

  return allSticks;
}

// ---- Aggregate into stock groups by Level + Carbon ------------------------

/**
 * Normalize a level string for grouping.
 * "Intermediate" → "INTERMEDIATE", "Jr" → "JUNIOR", etc.
 */
function normalizeLevel(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (upper.startsWith("INT")) return "INTERMEDIATE";
  if (upper.startsWith("JR") || upper.startsWith("JUN")) return "JUNIOR";
  if (upper.startsWith("SR") || upper.startsWith("SEN")) return "SENIOR";
  if (upper.startsWith("GOAL")) return "GOALIE";
  if (upper.startsWith("TIER")) return "TIER 1";
  return upper;
}

/** Normalize carbon string: "18k" → "18K" */
function normalizeCarbon(raw: string): string {
  return raw.toUpperCase().trim();
}

/**
 * Build a grouping key from Level + Carbon.
 * e.g. "INTERMEDIATE|18K"
 */
export function buildGroupKey(level: string, carbon: string): string {
  return `${normalizeLevel(level)}|${normalizeCarbon(carbon)}`;
}

/**
 * Aggregate individual stick records into stock groups by Level + Carbon.
 * Only counts sticks with a valid Level and Carbon.
 */
export function aggregateStockGroups(sticks: StickRecord[]): StockGroup[] {
  const groups = new Map<string, StockGroup>();

  for (const stick of sticks) {
    if (!stick.level || !stick.carbon) continue;

    const key = buildGroupKey(stick.level, stick.carbon);
    let group = groups.get(key);
    if (!group) {
      group = {
        level: normalizeLevel(stick.level),
        carbon: normalizeCarbon(stick.carbon),
        groupKey: key,
        available: 0,
        sold: 0,
        total: 0,
        availableSerials: [],
      };
      groups.set(key, group);
    }

    group.total++;
    const status = stick.status.toLowerCase().trim();
    if (status === "available") {
      group.available++;
      group.availableSerials.push(stick.serial_number);
    } else if (status === "sold") {
      group.sold++;
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.groupKey.localeCompare(b.groupKey)
  );
}

// ---- Formatted output for prompt injection --------------------------------

/**
 * Fetch stick data from all tabs and format as a text block for Claude.
 */
export async function fetchSheetSnapshot(): Promise<string> {
  try {
    const sticks = await fetchAllStickRecords();

    if (sticks.length === 0) {
      return [
        "## ⚠️ Zoho Sheet Data Empty",
        "",
        "No stick records found in the Player or Goalie tabs.",
        "Check that ZOHO_SHEET_RESOURCE_ID is correct.",
      ].join("\n");
    }

    const groups = aggregateStockGroups(sticks);

    const header = ["Level", "Carbon", "Available", "Sold", "Total"];
    const rows = groups.map((g) => [
      g.level,
      g.carbon,
      String(g.available),
      String(g.sold),
      String(g.total),
    ]);

    const table = formatSheetTable(header, rows);

    const totalAvailable = groups.reduce((sum, g) => sum + g.available, 0);
    const totalSold = groups.reduce((sum, g) => sum + g.sold, 0);

    return [
      "## Master Spreadsheet — Stick Inventory (Source of Truth)",
      `Total Sticks: ${sticks.length} (${totalAvailable} available, ${totalSold} sold)`,
      `Stock Groups (Level + Carbon): ${groups.length}`,
      `Tabs read: ${INVENTORY_TABS.join(", ")}`,
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
