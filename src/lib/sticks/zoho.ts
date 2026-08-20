// ---------------------------------------------------------------------------
// Zoho Sheet client for the Stick Inventory module (/inventory) — ported from
// the standalone tiltinventory app's src/lib/zoho.ts.
//
// NOTE: this is deliberately separate from src/lib/zoho.ts (Zoho Books /
// Inventory for the Stockton agent). Both use the SAME plain ZOHO_* OAuth
// self-client vars (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN /
// ZOHO_ACCOUNTS_URL) — intended, it's the same Zoho self client — but this one
// talks to Zoho Sheet API v2 against the stick workbook (ZOHO_WORKBOOK_ID).
// Selling requires the refresh token to carry a ZohoSheet write scope.
// ---------------------------------------------------------------------------
import { HockeyStick, SellResult } from "@/lib/sticks/types";

const ZOHO_BASE_URL = "https://sheet.zoho.com/api/v2";
const PLAYER_STICK_SHEET =
  process.env.ZOHO_PLAYER_STICK_SHEET || "Player Sticks";

/** True when the module has its workbook configured (graceful no-env mode otherwise). */
export function sticksConfigured(): boolean {
  return Boolean(process.env.ZOHO_WORKBOOK_ID);
}

export const NOT_CONFIGURED_MESSAGE =
  "Stick inventory isn't connected yet — set ZOHO_WORKBOOK_ID (and the ZOHO_* OAuth vars) to link the Zoho Sheet stick workbook.";

function workbookId(): string {
  const id = process.env.ZOHO_WORKBOOK_ID;
  if (!id) throw new Error(NOT_CONFIGURED_MESSAGE);
  return id;
}

async function getAccessToken(): Promise<string> {
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN!;
  const clientId = process.env.ZOHO_CLIENT_ID!;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET!;
  const accountsUrl =
    process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";

  const tokenUrl = `${accountsUrl}/oauth/v2/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Failed to refresh Zoho token (${response.status}): ${JSON.stringify(data)}`
    );
  }

  if (!data.access_token) {
    throw new Error(`No access token in response: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function parseRow(row: Record<string, string>, rowIndex: number): HockeyStick {
  return {
    row_index: rowIndex,
    level: row["Level"] || "",
    size: row["Size (inch)"] || row["Size"] || "",
    carbon: row["Carbon"] || "",
    kick_point: row["Kick Point"] || "",
    hand: row["Hand"] || "",
    flex: row["Flex"] || "",
    curve: row["Curve"] || "",
    base_color: row["Base Color"] || "",
    decal_color: row["Decal Color"] || "",
    serial_number: row["Serial Number"] || "",
    price: row["Price"] || "",
    status: row["Status"] || "",
    date_sold: row["Date Sold"] || "",
  };
}

export async function getInventory(): Promise<HockeyStick[]> {
  const accessToken = await getAccessToken();

  const url =
    `${ZOHO_BASE_URL}/${workbookId()}?method=worksheet.records.fetch` +
    `&worksheet_name=${encodeURIComponent(PLAYER_STICK_SHEET)}` +
    `&header_row=1&start_row=2&row_count=1000`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Failed to fetch inventory (${response.status}): ${JSON.stringify(data)}`
    );
  }

  if (data.status !== "success" || !data.records) {
    // If no records found, return empty
    if (data.error_code === 2872 || data.error_message?.includes("No records")) {
      return [];
    }
    throw new Error(`Zoho API error: ${JSON.stringify(data)}`);
  }

  return data.records.map(
    (record: { row_index: number; [key: string]: unknown }) => {
      const row: Record<string, string> = {};
      for (const [key, value] of Object.entries(record)) {
        if (key !== "row_index") {
          row[key] = String(value);
        }
      }
      return parseRow(row, record.row_index);
    }
  );
}

export async function searchBySerialNumber(
  serialNumber: string
): Promise<HockeyStick | null> {
  const inventory = await getInventory();
  const normalizedSearch = serialNumber.trim().toUpperCase();

  return (
    inventory.find(
      (stick) => stick.serial_number.toUpperCase() === normalizedSearch
    ) || null
  );
}

export async function markAsSold(serialNumber: string): Promise<SellResult> {
  const accessToken = await getAccessToken();

  const stick = await searchBySerialNumber(serialNumber);
  if (!stick) {
    return {
      success: false,
      message: `Stick with serial number ${serialNumber} not found in inventory.`,
    };
  }

  if (String(stick.status ?? "").trim().toLowerCase() === "sold") {
    return {
      success: true,
      message: `Stick ${serialNumber} was already marked sold.`,
      stick,
    };
  }

  // Flag the row in place. It used to copy the stick onto a "Sold Stick" tab
  // and then delete the row from the player tab, which was wrong twice over.
  //
  // Wrong about the data model: everything else treats a sale as Status "Sold"
  // plus a Date Sold on the row itself — that is what the storefront writes,
  // what the 107 sold rows on the sheet look like, and what the sold-sticks
  // metric counts. Deleting the row would have hidden the sale from all three
  // and thrown away the stick's specs.
  //
  // Wrong about atomicity: the copy came first and the delete second, with no
  // way to undo the copy. When the delete failed — as it did on H2512-05979 —
  // the stick ended up recorded as sold AND still listed for sale.
  //
  // One update, on one row. Nothing to half-finish.
  const soldOn = new Date().toISOString().split("T")[0];
  const res = await fetch(`${ZOHO_BASE_URL}/${workbookId()}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      method: "worksheet.records.update",
      worksheet_name: PLAYER_STICK_SHEET,
      header_row: "1",
      criteria: `"Serial Number" = "${stick.serial_number}"`,
      data: JSON.stringify({ Status: "Sold", "Date Sold": soldOn }),
    }).toString(),
  });

  // Zoho answers 200 with a failure body often enough that the status code
  // alone means nothing. The old code reported response.statusText, which is
  // empty over HTTP/2 — that is why the alert read "Failed to delete from
  // Player Stick sheet:" with nothing after the colon.
  const body = await res.text();
  if (!res.ok || body.includes('"status":"failure"')) {
    throw new Error(
      `Couldn't mark ${serialNumber} sold on "${PLAYER_STICK_SHEET}" ` +
        `(HTTP ${res.status}): ${body.slice(0, 300)}`
    );
  }

  return {
    success: true,
    message: `Stick ${serialNumber} is marked sold (${soldOn}).`,
    stick: { ...stick, status: "Sold", date_sold: soldOn },
  };
}
