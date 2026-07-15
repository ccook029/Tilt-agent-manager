// ---------------------------------------------------------------------------
// gsc.ts — Google Search Console (real search-query data for Sage, SEO)
//
// Reuses the SAME service account as GA4 (GOOGLE_APPLICATION_CREDENTIALS_JSON,
// base64 JSON). One-time setup: in Search Console → Settings → Users and
// permissions, add the service account's client_email as a user (Full or
// Restricted), then set GSC_SITE_URL in Vercel — "sc-domain:tilthockey.com"
// for a Domain property, or "https://tilthockey.com/" for a URL-prefix one.
//
// No googleapis dependency: we mint the OAuth token ourselves (RS256 JWT via
// Node crypto) and call the Search Analytics REST endpoint directly.
// ---------------------------------------------------------------------------
import { createSign } from "crypto";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function isGscConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && process.env.GSC_SITE_URL
  );
}

function getCredentials(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not set");
  return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Exchange a service-account JWT for a short-lived access token. */
async function getAccessToken(): Promise<string> {
  const creds = getCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(creds.private_key));

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Search Console auth failed: ${json.error_description ?? res.status}`
    );
  }
  return json.access_token;
}

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function queryAnalytics(
  token: string,
  siteUrl: string,
  body: Record<string, unknown>
): Promise<GscRow[]> {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    rows?: GscRow[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      `Search Console query failed: ${json.error?.message ?? res.status}`
    );
  }
  return json.rows ?? [];
}

function formatRows(rows: GscRow[]): string {
  if (rows.length === 0) return "(no rows)";
  return rows
    .map(
      (r) =>
        `- "${r.keys.join(" | ")}" — ${r.clicks} clicks, ${r.impressions} impressions, ${(r.ctr * 100).toFixed(1)}% CTR, avg position ${r.position.toFixed(1)}`
    )
    .join("\n");
}

/**
 * Real search-query performance for the last `days` days, formatted for
 * prompt injection. Throws if not configured — callers wrap with a fallback.
 */
export async function fetchSearchConsoleData(days = 28): Promise<string> {
  const siteUrl = process.env.GSC_SITE_URL;
  if (!siteUrl) throw new Error("GSC_SITE_URL is not set");
  const token = await getAccessToken();

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const base = { startDate, endDate, dataState: "final" };

  const [byQuery, byPage] = await Promise.all([
    queryAnalytics(token, siteUrl, {
      ...base,
      dimensions: ["query"],
      rowLimit: 25,
    }),
    queryAnalytics(token, siteUrl, {
      ...base,
      dimensions: ["page"],
      rowLimit: 15,
    }),
  ]);

  return [
    `## Google Search performance — last ${days} days (${startDate} → ${endDate})`,
    "",
    "### Top search queries",
    formatRows(byQuery),
    "",
    "### Top pages in search",
    formatRows(byPage),
  ].join("\n");
}
