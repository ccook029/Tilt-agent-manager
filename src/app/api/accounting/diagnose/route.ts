// ---------------------------------------------------------------------------
// GET /api/accounting/diagnose — Read-only Zoho Books connection diagnostic.
//
// Returns the exact raw error from each Zoho Books endpoint plus which env vars
// are present (booleans only — never the secret values). Use this to tell a
// scope/token problem (401/403) apart from a data-center mismatch (404 / wrong
// host). No Claude call, no email — returns instantly. Safe to delete after setup.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { fetchBooksSnapshot, isMcpConfigured } from "@/lib/zoho-books";
import { getAccessToken } from "@/lib/zoho";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = {
    ZOHO_CLIENT_ID: !!process.env.ZOHO_CLIENT_ID,
    ZOHO_CLIENT_SECRET: !!process.env.ZOHO_CLIENT_SECRET,
    ZOHO_REFRESH_TOKEN: !!process.env.ZOHO_REFRESH_TOKEN,
    ZOHO_ORGANIZATION_ID: process.env.ZOHO_ORGANIZATION_ID ?? "(not set)",
    ZOHO_DOMAIN: process.env.ZOHO_DOMAIN ?? "(default: https://www.zohoapis.com)",
    ZOHO_ACCOUNTS_URL: process.env.ZOHO_ACCOUNTS_URL ?? "(default: https://accounts.zoho.com)",
    ZOHO_BOOKS_MCP_configured: isMcpConfigured(),
  };

  // Step 1: can we even mint an access token from the refresh token?
  let tokenStatus = "ok";
  try {
    const t = await getAccessToken();
    tokenStatus = t ? "ok (access token obtained)" : "empty token returned";
  } catch (err) {
    tokenStatus = `FAILED — ${err instanceof Error ? err.message : String(err)}`;
  }

  // Step 2: the actual Books snapshot, which embeds each endpoint's raw error.
  let snapshot = "";
  try {
    snapshot = await fetchBooksSnapshot();
  } catch (err) {
    snapshot = `fetchBooksSnapshot threw: ${err instanceof Error ? err.message : String(err)}`;
  }

  return NextResponse.json(
    { env, tokenStatus, snapshot },
    { headers: { "Content-Type": "application/json" } }
  );
}
