// ---------------------------------------------------------------------------
// GET /api/publish/tiktok/callback — TikTok redirects here after authorize
//
// Verifies the CSRF state cookie, exchanges the code for tokens (stored in
// KV with auto-refresh), and lands Chris back on /publish with the TikTok
// card green. The browser carries the Tilt OS session cookie through the
// round-trip, so the middleware keeps this owner-gated.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthCode,
  TIKTOK_STATE_COOKIE,
} from "@/lib/publish/tiktok-store";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (query: string) =>
    NextResponse.redirect(new URL(`/publish?${query}`, request.nextUrl.origin));

  const denied = params.get("error");
  if (denied) {
    return back(`tiktok=denied&reason=${encodeURIComponent(denied)}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  const expected = request.cookies.get(TIKTOK_STATE_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected) {
    return back("tiktok=error&reason=state_mismatch");
  }

  try {
    const redirectUri = `${request.nextUrl.origin}/api/publish/tiktok/callback`;
    await exchangeAuthCode(code, redirectUri);
    const res = back("tiktok=connected");
    res.cookies.delete(TIKTOK_STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("[tiktok] callback exchange failed:", err);
    return back(
      `tiktok=error&reason=${encodeURIComponent(err instanceof Error ? err.message : "exchange_failed")}`
    );
  }
}
