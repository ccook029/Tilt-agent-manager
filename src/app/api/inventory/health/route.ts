// ---------------------------------------------------------------------------
// GET /api/inventory/health — Diagnostic endpoint for Zoho connectivity
//
// Returns the status of each Zoho integration (Inventory API, Sheet API)
// so operators can quickly identify which connection is failing and why.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/zoho";
import { fetchAllStickRecords } from "@/lib/zoho-sheet";
import { fetchAllItems } from "@/lib/zoho";

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

  // 3. Zoho Sheet API
  const sheetStart = Date.now();
  try {
    const sticks = await fetchAllStickRecords();
    checks.sheet = {
      status: "ok",
      message: `Connected — ${sticks.length} stick records found (Player + Goalie tabs)`,
      durationMs: Date.now() - sheetStart,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.sheet = { status: "error", message: msg, durationMs: Date.now() - sheetStart };
  }

  const healthy = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json({
    healthy,
    checks,
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
