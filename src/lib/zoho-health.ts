// ---------------------------------------------------------------------------
// zoho-health.ts — one authoritative read of the Zoho connection.
//
// The recurring "Zoho is broken again" problem has several DIFFERENT causes
// that all looked the same in the old diagnostic. This module tells them apart
// and says, in one line, exactly what's wrong and what to do:
//
//   • Refresh token dead        → can't even mint an access token → reconnect
//   • Token valid but DENIED    → 401/403 code 57 → missing scope OR the token
//                                 was generated under a Zoho login that isn't a
//                                 user on this org → reconnect with the right
//                                 account + full scopes
//   • Wrong org / data center   → the org id isn't visible to this token (404 /
//                                 not in the organizations list)
//   • Rate limited              → transient 429, not a real break
//   • Connected                 → green
//
// It probes Books, Inventory, and Sheet independently, so a Books-only failure
// is never mistaken for a total outage.
// ---------------------------------------------------------------------------
import { getAccessToken, getRefreshTokenSource } from "./zoho";

export interface ProductProbe {
  product: "books" | "inventory" | "sheet";
  ok: boolean;
  httpStatus: number | null;
  zohoCode?: number;
  message?: string;
  verdict: string;
}

export interface ZohoHealth {
  refreshTokenSource: "kv" | "env" | "none";
  tokenMint: { ok: boolean; error?: string };
  organizationId: string | null;
  domain: string;
  /** Books orgs this token can actually see (null if the list call failed). */
  visibleBooksOrgs: { id: string; name: string }[] | null;
  /** Is the configured org among the visible ones? (the wrong-login tell) */
  configuredOrgVisible: boolean | null;
  products: ProductProbe[];
  verdict: string;
  nextStep: string;
}

const AUTH_DENIED = new Set([401, 403]);

interface RawProbe {
  httpStatus: number;
  zohoCode?: number;
  message?: string;
  json?: unknown;
}

/** One authenticated GET; captures HTTP status + Zoho's own code/message. */
async function authedGet(url: string, token: string): Promise<RawProbe> {
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  let zohoCode: number | undefined;
  let message: string | undefined;
  let json: unknown;
  try {
    json = await res.json();
    const j = json as { code?: number; message?: string };
    zohoCode = typeof j.code === "number" ? j.code : undefined;
    message = j.message;
  } catch {
    /* non-JSON body (e.g. an HTML gateway page) */
  }
  return { httpStatus: res.status, zohoCode, message, json };
}

function classify(
  product: ProductProbe["product"],
  httpStatus: number,
  zohoCode: number | undefined,
  orgId: string | null
): { ok: boolean; verdict: string } {
  // Zoho returns code 0 on success for Books/Inventory JSON APIs.
  if (httpStatus >= 200 && httpStatus < 300) {
    return { ok: true, verdict: "OK — connected." };
  }
  if (AUTH_DENIED.has(httpStatus)) {
    return {
      ok: false,
      verdict: `DENIED (HTTP ${httpStatus}${zohoCode != null ? `, code ${zohoCode}` : ""}) — the token is valid but not authorized for ${product}. Cause: it was generated without the ${product} scope, or under a Zoho login that isn't a user on org ${orgId ?? "(unset)"}. Fix: reconnect at /zoho/reconnect with the full scope string, signed into the Zoho account that owns the books.`,
    };
  }
  if (httpStatus === 404) {
    return {
      ok: false,
      verdict: `NOT FOUND (HTTP 404) — wrong data center (ZOHO_DOMAIN) or wrong ZOHO_ORGANIZATION_ID for ${product}.`,
    };
  }
  if (httpStatus === 429) {
    return {
      ok: false,
      verdict: "RATE LIMITED (HTTP 429) — Zoho is throttling; transient, retry shortly.",
    };
  }
  return { ok: false, verdict: `Unexpected HTTP ${httpStatus} on ${product}.` };
}

export async function checkZohoHealth(): Promise<ZohoHealth> {
  const domain = process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";
  const organizationId = process.env.ZOHO_ORGANIZATION_ID ?? null;
  const refreshTokenSource = await getRefreshTokenSource();

  // Step 1 — can we mint an access token at all?
  let token: string | null = null;
  let tokenMint: ZohoHealth["tokenMint"];
  try {
    token = await getAccessToken();
    tokenMint = { ok: true };
  } catch (err) {
    tokenMint = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!token) {
    return {
      refreshTokenSource,
      tokenMint,
      organizationId,
      domain,
      visibleBooksOrgs: null,
      configuredOrgVisible: null,
      products: [],
      verdict:
        "🔴 Refresh token is dead — the app can't authenticate to Zoho at all (expired or revoked).",
      nextStep:
        "Reconnect at /zoho/reconnect (sign into the Zoho account that owns the books; use the full scope string on the page).",
    };
  }

  // Step 2 — which Books orgs can this token see? Directly reveals a wrong-login
  // token: it authenticates fine but can't see org 776261458.
  let visibleBooksOrgs: ZohoHealth["visibleBooksOrgs"] = null;
  let configuredOrgVisible: boolean | null = null;
  try {
    const orgsRes = await authedGet(`${domain}/books/v3/organizations`, token);
    if (orgsRes.httpStatus >= 200 && orgsRes.httpStatus < 300) {
      const list =
        (orgsRes.json as { organizations?: { organization_id: string; name: string }[] })
          .organizations ?? [];
      visibleBooksOrgs = list.map((o) => ({ id: String(o.organization_id), name: o.name }));
      configuredOrgVisible = organizationId
        ? visibleBooksOrgs.some((o) => o.id === organizationId)
        : null;
    }
  } catch {
    /* leave as null — the per-product probes still classify */
  }

  // Step 3 — probe each product independently.
  const products: ProductProbe[] = [];

  const booksProbe = await authedGet(
    `${domain}/books/v3/chartofaccounts?organization_id=${organizationId ?? ""}&per_page=1`,
    token
  ).catch((e): RawProbe => ({ httpStatus: 0, message: String(e) }));
  {
    const c = classify("books", booksProbe.httpStatus, booksProbe.zohoCode, organizationId);
    products.push({
      product: "books",
      ok: c.ok,
      httpStatus: booksProbe.httpStatus || null,
      zohoCode: booksProbe.zohoCode,
      message: booksProbe.message,
      verdict: c.verdict,
    });
  }

  const invProbe = await authedGet(
    `${domain}/inventory/v1/items?organization_id=${organizationId ?? ""}&per_page=1`,
    token
  ).catch((e): RawProbe => ({ httpStatus: 0, message: String(e) }));
  {
    const c = classify("inventory", invProbe.httpStatus, invProbe.zohoCode, organizationId);
    products.push({
      product: "inventory",
      ok: c.ok,
      httpStatus: invProbe.httpStatus || null,
      zohoCode: invProbe.zohoCode,
      message: invProbe.message,
      verdict: c.verdict,
    });
  }

  // Sheet: only probe when a resource is configured (it needs a specific id).
  const sheetResource = process.env.ZOHO_SHEET_RESOURCE_ID;
  if (sheetResource) {
    const sheetBase = sheetDomain(domain);
    const sheetProbe = await authedGet(
      `${sheetBase}/${sheetResource}?method=worksheet.list`,
      token
    ).catch((e): RawProbe => ({ httpStatus: 0, message: String(e) }));
    const c = classify("sheet", sheetProbe.httpStatus, sheetProbe.zohoCode, organizationId);
    products.push({
      product: "sheet",
      ok: c.ok,
      httpStatus: sheetProbe.httpStatus || null,
      zohoCode: sheetProbe.zohoCode,
      message: sheetProbe.message,
      verdict: c.verdict,
    });
  }

  // Overall verdict.
  const denied = products.filter((p) => AUTH_DENIED.has(p.httpStatus ?? 0));
  const failed = products.filter((p) => !p.ok);
  let verdict: string;
  let nextStep: string;

  if (failed.length === 0) {
    verdict = "🟢 Fully connected — every configured Zoho product is authorized.";
    nextStep = "Nothing to do.";
  } else if (configuredOrgVisible === false) {
    verdict = `🔴 Wrong Zoho login — this token can't see org ${organizationId}. It authenticates, but against the wrong Zoho account.`;
    nextStep =
      "Reconnect at /zoho/reconnect while signed into the Zoho account that can open Zoho Books for this org.";
  } else if (denied.length > 0) {
    verdict = `🟠 Authenticated but denied on: ${denied.map((p) => p.product).join(", ")}. The token is missing those scopes (or the account lacks access).`;
    nextStep =
      "Reconnect at /zoho/reconnect using the full scope string on the page (Books + Inventory + Sheet), signed into the books-owner Zoho account.";
  } else {
    verdict = `🟠 Problem on: ${failed.map((p) => p.product).join(", ")}. See each product's verdict below.`;
    nextStep = "Check ZOHO_DOMAIN / ZOHO_ORGANIZATION_ID, or reconnect at /zoho/reconnect.";
  }

  return {
    refreshTokenSource,
    tokenMint,
    organizationId,
    domain,
    visibleBooksOrgs,
    configuredOrgVisible,
    products,
    verdict,
    nextStep,
  };
}

/** Mirror of zoho-sheet.ts's data-center inference, for the Sheet probe URL. */
function sheetDomain(zohoDomain: string): string {
  if (process.env.ZOHO_SHEET_DOMAIN) {
    return process.env.ZOHO_SHEET_DOMAIN.replace(/\/+$/, "") + "/api/v2";
  }
  if (zohoDomain.includes(".zoho.eu") || zohoDomain.includes("zohoapis.eu")) return "https://sheet.zoho.eu/api/v2";
  if (zohoDomain.includes(".zoho.in") || zohoDomain.includes("zohoapis.in")) return "https://sheet.zoho.in/api/v2";
  if (zohoDomain.includes(".zoho.com.au") || zohoDomain.includes("zohoapis.com.au")) return "https://sheet.zoho.com.au/api/v2";
  if (zohoDomain.includes(".zoho.jp") || zohoDomain.includes("zohoapis.jp")) return "https://sheet.zoho.jp/api/v2";
  return "https://sheet.zoho.com/api/v2";
}
