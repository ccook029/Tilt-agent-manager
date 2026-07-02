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
import { isInboxConfigured, fetchInteracDetailed } from "@/lib/email-inbox";

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

  // Step 3: email inbox (Interac e-Transfer notifications) connection test.
  let inbox: Record<string, unknown>;
  if (!isInboxConfigured()) {
    inbox = {
      configured: false,
      status:
        "NOT CONNECTED — set INBOX_USER and INBOX_APP_PASSWORD in Vercel (Zoho Mail: enable IMAP + create an app password), then redeploy.",
    };
  } else {
    try {
      const detail = await fetchInteracDetailed({ sinceDays: 365, max: 50 });
      inbox = {
        configured: true,
        status: "ok — connected and searched",
        mailbox: detail.user,
        host: detail.host,
        foldersSearched: detail.foldersSearched,
        interacNotificationsFoundLast12mo: detail.notifications.length,
        sample: detail.notifications.slice(0, 5).map((n) => ({
          date: n.date,
          direction: n.direction,
          name: n.name ?? "(name not parsed)",
          amount: n.amount ?? null,
        })),
        hint:
          detail.notifications.length === 0
            ? "Connected fine but found no Interac emails in ANY folder of this mailbox. Most likely the e-Transfer notifications go to a DIFFERENT address — set INBOX_USER (and app password) to the mailbox that actually receives them."
            : undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      inbox = {
        configured: true,
        status: `FAILED — ${msg}`,
        hint: /auth|login|credential/i.test(msg)
          ? "Auth failed: check the app password, confirm IMAP Access is enabled in Zoho Mail settings, and note Zoho Mail IMAP requires a paid Mail plan."
          : "Connection failed: if your mailbox is a personal @zoho.com address set IMAP_HOST=imap.zoho.com; custom domains use imappro.zoho.com (the default).",
      };
    }
  }

  return NextResponse.json(
    { env, tokenStatus, inbox, snapshot },
    { headers: { "Content-Type": "application/json" } }
  );
}
