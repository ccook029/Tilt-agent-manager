// ---------------------------------------------------------------------------
// GET /api/accounting/diagnose — Read-only Zoho Books connection diagnostic.
//
// Returns the exact raw error from each Zoho Books endpoint plus which env vars
// are present (booleans only — never the secret values). Use this to tell a
// scope/token problem (401/403) apart from a data-center mismatch (404 / wrong
// host). No Claude call, no email — returns instantly. Safe to delete after setup.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { isMcpConfigured } from "@/lib/zoho-books";
import { checkZohoHealth } from "@/lib/zoho-health";
import { isInboxConfigured, fetchInteracDetailed } from "@/lib/email-inbox";
import { fetchInboxDocuments } from "@/lib/zoho-documents";
import { guardAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await guardAccountingOwner(request);
  if (guard) return guard;

  // Deploy stamp — proves which build is answering. Vercel injects the SHA.
  const deploy = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "(local/dev)",
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.slice(0, 80) ?? "",
    servedAt: new Date().toISOString(),
  };

  const env = {
    ZOHO_CLIENT_ID: !!process.env.ZOHO_CLIENT_ID,
    ZOHO_CLIENT_SECRET: !!process.env.ZOHO_CLIENT_SECRET,
    ZOHO_REFRESH_TOKEN: !!process.env.ZOHO_REFRESH_TOKEN,
    ZOHO_ORGANIZATION_ID: process.env.ZOHO_ORGANIZATION_ID ?? "(not set)",
    ZOHO_DOMAIN: process.env.ZOHO_DOMAIN ?? "(default: https://www.zohoapis.com)",
    ZOHO_ACCOUNTS_URL: process.env.ZOHO_ACCOUNTS_URL ?? "(default: https://accounts.zoho.com)",
    ZOHO_BOOKS_MCP_configured: isMcpConfigured(),
  };

  // Structured Zoho health: token mint + per-product (Books / Inventory / Sheet)
  // authorization + which orgs the token can see, with a one-line verdict that
  // distinguishes a dead token from a scope/wrong-login denial.
  const zoho = await checkZohoHealth().catch((err) => ({
    verdict: `🔴 Health check crashed: ${err instanceof Error ? err.message : String(err)}`,
  }));

  // Email inbox (Interac e-Transfer notifications) connection test.
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

  // Zoho Books Documents inbox (AP bills awaiting entry) reachability.
  const docsRes = await fetchInboxDocuments({ max: 25 });
  const documents = {
    reachable: docsRes.reachable,
    count: docsRes.documents.length,
    error: docsRes.error,
    sample: docsRes.documents.slice(0, 5).map((d) => ({
      id: d.id,
      fileName: d.fileName,
      vendor: d.vendor ?? null,
      amount: d.amount ?? null,
      date: d.date ?? null,
      status: d.status ?? null,
    })),
    hint: !docsRes.reachable
      ? "Couldn't list the Books Documents inbox. Confirm the token has ZohoBooks.fullaccess.all, then check the endpoint shape — Slice 2 refines the exact download path."
      : docsRes.documents.length === 0
        ? "Connected but the inbox is empty (or these docs are already processed)."
        : undefined,
  };

  return NextResponse.json(
    { deploy, verdict: zoho.verdict, zoho, env, inbox, documents },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, must-revalidate",
      },
    }
  );
}
