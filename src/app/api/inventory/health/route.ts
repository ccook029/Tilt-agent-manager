// ---------------------------------------------------------------------------
// GET /api/inventory/health — Diagnostic endpoint for Zoho connectivity
//
// Returns the status of each Zoho integration (Inventory API, Sheet API)
// so operators can quickly identify which connection is failing and why.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/zoho";
import { fetchAllStickRecords, fetchSheetRows } from "@/lib/zoho-sheet";
import { fetchAllItems } from "@/lib/zoho";
import { compareSheetToInventory } from "@/lib/zoho-sync";

interface Check {
  status: "ok" | "error";
  message: string;
  durationMs: number;
}

export async function GET() {
  const checks: Record<string, Check> = {};

  // 1. OAuth token
  const tokenStart = Date.now();
  try {
    await getAccessToken();
    checks.oauth = {
      status: "ok",
      message: "Access token obtained successfully",
      durationMs: Date.now() - tokenStart,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.oauth = { status: "error", message: msg, durationMs: Date.now() - tokenStart };
    // If OAuth fails, everything else will too
    return NextResponse.json({
      healthy: false,
      checks,
      env: envSummary(),
    });
  }

  // 2. Zoho Inventory API
  const invStart = Date.now();
  try {
    const items = await fetchAllItems();
    checks.inventory = {
      status: "ok",
      message: `Connected — ${items.length} items found`,
      durationMs: Date.now() - invStart,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.inventory = { status: "error", message: msg, durationMs: Date.now() - invStart };
  }

  // 3. Zoho Sheet API — with per-tab diagnostics
  const sheetStart = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabDiagnostics: Record<string, any> = {};
  try {
    const sticks = await fetchAllStickRecords();

    // Per-tab breakdown
    const playerSticks = sticks.filter((s) => s.tab === "Player");
    const goalieSticks = sticks.filter((s) => s.tab === "Goalie");
    const playerAvailable = playerSticks.filter((s) => s.status.toLowerCase().trim() === "available").length;
    const goalieAvailable = goalieSticks.filter((s) => s.status.toLowerCase().trim() === "available").length;

    // Size diagnostics for Senior sticks (EXT classification debugging)
    const seniorSticks = playerSticks.filter((s) => {
      const level = s.level.toUpperCase().trim();
      return level.startsWith("SR") || level.startsWith("SEN");
    });
    const seniorSizes = seniorSticks.map((s) => s.size).sort((a, b) => a - b);
    const seniorAvailSizes = seniorSticks
      .filter((s) => s.status.toLowerCase().trim() === "available")
      .map((s) => ({ size: s.size, carbon: s.carbon, serial: s.serial_number }));

    tabDiagnostics.player = {
      totalRecords: playerSticks.length,
      available: playerAvailable,
      sampleLevels: [...new Set(playerSticks.slice(0, 50).map((s) => s.level))],
      seniorSizeDebug: {
        totalSenior: seniorSticks.length,
        allSizes: [...new Set(seniorSizes)],
        above66: seniorSticks.filter((s) => s.size > 66).length,
        atOrBelow66: seniorSticks.filter((s) => s.size <= 66).length,
        sizeZero: seniorSticks.filter((s) => s.size === 0).length,
        sampleAvailable: seniorAvailSizes.slice(0, 20),
      },
    };
    tabDiagnostics.goalie = {
      totalRecords: goalieSticks.length,
      available: goalieAvailable,
      sampleLevels: [...new Set(goalieSticks.slice(0, 50).map((s) => s.level))],
      sampleStatuses: [...new Set(goalieSticks.map((s) => s.status))],
    };

    // Fetch raw Goalie rows to show column names
    try {
      const rawGoalieRows = await fetchSheetRows("Goalie");
      tabDiagnostics.goalie.rawRowCount = rawGoalieRows.length;
      tabDiagnostics.goalie.columnNames = rawGoalieRows.length > 0
        ? Object.keys(rawGoalieRows[0]).filter((k) => k !== "row_index")
        : [];
      // First 3 raw rows for debugging
      tabDiagnostics.goalie.sampleRawRows = rawGoalieRows.slice(0, 3).map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clean: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k !== "row_index") clean[k] = v;
        }
        return clean;
      });
    } catch { /* ignore, main check already covers this */ }

    checks.sheet = {
      status: "ok",
      message: `Connected — ${sticks.length} stick records (Player: ${playerSticks.length}, Goalie: ${goalieSticks.length})`,
      durationMs: Date.now() - sheetStart,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.sheet = { status: "error", message: msg, durationMs: Date.now() - sheetStart };
  }

  // 4. Sync comparison debug — run the actual comparison logic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let syncDebug: Record<string, any> = {};
  try {
    const diff = await compareSheetToInventory();
    syncDebug = {
      totalSheetAvailable: diff.totalSheetAvailable,
      unmatchedSticks: diff.unmatchedSticks,
      inSync: diff.inSync.map((m) => ({
        sku: m.sku,
        sheetCount: m.sheetCount,
        inventoryCount: m.inventoryCount,
      })),
      discrepancies: diff.discrepancies.map((m) => ({
        sku: m.sku,
        sheetCount: m.sheetCount,
        inventoryCount: m.inventoryCount,
        difference: m.difference,
      })),
      unmappedSkus: diff.unmappedSkus.map((i) => i.sku),
      nonStickItems: diff.nonStickItems,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    syncDebug = { error: msg };
  }

  const healthy = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json({
    healthy,
    checks,
    tabDiagnostics,
    syncDebug,
    env: envSummary(),
  });
}

function envSummary() {
  return {
    ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID ? "set" : "MISSING",
    ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET ? "set" : "MISSING",
    ZOHO_REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN ? "set" : "MISSING",
    ZOHO_ORGANIZATION_ID: process.env.ZOHO_ORGANIZATION_ID ? "set" : "MISSING",
    ZOHO_SHEET_RESOURCE_ID: process.env.ZOHO_SHEET_RESOURCE_ID ? "set" : "MISSING",
    ZOHO_DOMAIN: process.env.ZOHO_DOMAIN ?? "(default: https://www.zohoapis.com)",
    ZOHO_SHEET_DOMAIN: process.env.ZOHO_SHEET_DOMAIN ?? "(auto-derived from ZOHO_DOMAIN)",
    ZOHO_ACCOUNTS_URL: process.env.ZOHO_ACCOUNTS_URL ?? "(default: https://accounts.zoho.com)",
  };
}
