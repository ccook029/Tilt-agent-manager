// ---------------------------------------------------------------------------
// GET /api/publish/tiktok/auth — start the TikTok connect flow
//
// Chris taps "Connect TikTok" on /publish (already signed in to Tilt OS, so
// the middleware gates this). We send him to TikTok's authorize screen for
// the Tilt account with a CSRF state cookie; TikTok redirects back to
// ../callback which stores the tokens. Requires TIKTOK_CLIENT_KEY (+ SECRET
// for the callback's code exchange).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { TIKTOK_STATE_COOKIE } from "@/lib/publish/tiktok-store";

export async function GET(request: NextRequest) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    return NextResponse.json(
      {
        error:
          "TIKTOK_CLIENT_KEY isn't set — create the TikTok developer app first (docs/PUBLISHER_SETUP.md Part 2).",
      },
      { status: 409 }
    );
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = `${request.nextUrl.origin}/api/publish/tiktok/callback`;
  const authorize = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authorize.searchParams.set("client_key", clientKey);
  authorize.searchParams.set("scope", "user.info.basic,video.publish");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);

  const res = NextResponse.redirect(authorize);
  res.cookies.set(TIKTOK_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/publish/tiktok",
    maxAge: 600,
  });
  return res;
}
