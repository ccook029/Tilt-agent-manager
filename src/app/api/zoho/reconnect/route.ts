// ---------------------------------------------------------------------------
// /api/zoho/reconnect — rotate the Zoho refresh token from inside HQ.
//
// The long-lived Zoho refresh token can be revoked (password reset, hitting the
// ~20-tokens-per-client cap during setup churn, manual revoke). When that
// happens every Zoho call — Books, Inventory, the stick Sheet — starts 401ing.
// This route lets the owner paste a fresh authorization/grant code from the
// Zoho API Console and swaps in a new permanent refresh token (stored in KV, no
// Vercel env edit, no redeploy), then verifies the connection is live.
//
//   GET  → { connected, source }        — current status
//   POST { code } → { connected }        — exchange the code + verify
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  getAccessToken,
  getRefreshTokenSource,
  exchangeAuthCodeForRefreshToken,
  invalidateTokenCache,
} from "@/lib/zoho";
import { guardAccountingOwner } from "@/lib/os-identity";

export const maxDuration = 60;

/** Prove the current refresh token actually works by minting an access token. */
async function checkConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    await getAccessToken();
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;

  const source = await getRefreshTokenSource();
  if (source === "none") {
    return NextResponse.json({
      ok: true,
      connected: false,
      source,
      error: "No refresh token configured yet.",
    });
  }
  const status = await checkConnection();
  return NextResponse.json({ ok: true, source, ...status });
}

export async function POST(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const code = String((body as { code?: string }).code ?? "").trim();
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "Paste the grant code from the Zoho API Console first." },
      { status: 400 }
    );
  }

  try {
    // Swap in the new token, then force a fresh mint and confirm it works.
    const refreshToken = await exchangeAuthCodeForRefreshToken(code);
    await invalidateTokenCache();
    const status = await checkConnection();
    if (!status.connected) {
      return NextResponse.json(
        {
          ok: false,
          connected: false,
          error: `Token stored, but a test call still failed: ${status.error ?? "unknown error"}. The code may be missing a scope.`,
        },
        { status: 502 }
      );
    }
    // The token is returned so the owner can copy it into tiltweb's env —
    // tiltweb holds its own ZOHO_REFRESH_TOKEN for sheet writes + invoices,
    // and a revocation kills both apps at once. Owner-gated route.
    return NextResponse.json({ ok: true, connected: true, refreshToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
