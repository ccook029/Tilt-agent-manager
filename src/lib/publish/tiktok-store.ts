// ---------------------------------------------------------------------------
// publish/tiktok-store.ts — TikTok OAuth tokens (KV) with auto-refresh
//
// TikTok access tokens live 24h; refresh tokens ~1 year. Once Chris connects
// the Tilt account via /api/publish/tiktok/auth, tokens live here and refresh
// themselves before every post — no manual re-auth until the refresh token
// itself expires. A manually-set TIKTOK_ACCESS_TOKEN env var still works as
// an override for testing.
//
// Env for the OAuth app (from the TikTok developer portal):
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "tiktok-oauth-tokens";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/** CSRF state cookie shared by the /api/publish/tiktok auth+callback routes. */
export const TIKTOK_STATE_COOKIE = "tiktok_oauth_state";

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token dies. */
  expiresAt: number;
  /** Epoch ms when the refresh token dies (re-auth needed after this). */
  refreshExpiresAt: number;
  openId?: string;
  scope?: string;
  updatedAt: string;
}

export function tiktokAppConfigured(): boolean {
  return Boolean(
    process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET
  );
}

export async function getStoredTokens(): Promise<TikTokTokens | null> {
  return (await kv.get<TikTokTokens>(KEY)) ?? null;
}

async function saveTokens(t: TikTokTokens): Promise<void> {
  await kv.set(KEY, t);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  params: Record<string, string>
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY ?? "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "",
      ...params,
    }),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

function toTokens(r: TokenResponse): TikTokTokens {
  if (!r.access_token || !r.refresh_token) {
    throw new Error(
      `TikTok token exchange failed: ${r.error_description ?? r.error ?? "no token returned"}`
    );
  }
  const now = Date.now();
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: now + (r.expires_in ?? 86_400) * 1000,
    refreshExpiresAt: now + (r.refresh_expires_in ?? 31_536_000) * 1000,
    openId: r.open_id,
    scope: r.scope,
    updatedAt: new Date().toISOString(),
  };
}

/** Exchange the OAuth callback code for tokens and persist them. */
export async function exchangeAuthCode(
  code: string,
  redirectUri: string
): Promise<TikTokTokens> {
  const tokens = toTokens(
    await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    })
  );
  await saveTokens(tokens);
  return tokens;
}

/**
 * A currently-valid access token, refreshing first when it's within 10
 * minutes of expiry. Returns null when TikTok isn't connected (or the
 * refresh token has died — reconnect via /api/publish/tiktok/auth).
 */
export async function getValidAccessToken(): Promise<string | null> {
  // Manual env token takes precedence (testing / pre-OAuth setups).
  if (process.env.TIKTOK_ACCESS_TOKEN) return process.env.TIKTOK_ACCESS_TOKEN;

  const stored = await getStoredTokens().catch(() => null);
  if (!stored) return null;
  if (Date.now() < stored.expiresAt - 10 * 60_000) return stored.accessToken;

  // Refresh path.
  if (Date.now() >= stored.refreshExpiresAt || !tiktokAppConfigured()) {
    return null; // refresh token dead or app creds missing — needs re-auth
  }
  try {
    const fresh = toTokens(
      await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
      })
    );
    await saveTokens(fresh);
    return fresh.accessToken;
  } catch (err) {
    console.error("[tiktok] token refresh failed:", err);
    return null;
  }
}
