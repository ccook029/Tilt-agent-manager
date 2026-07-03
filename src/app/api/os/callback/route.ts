// ---------------------------------------------------------------------------
// GET /api/os/callback?token=<60s OS token>[&next=/path]
//
// Lands the click-through SSO from tiltweb's /admin/os-authorize: staff who
// are already signed in to tiltweb's /admin arrive here with a short-lived
// OS token. We verify it, mint a fresh full-length session, set the cookie,
// and continue into the OS.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  OS_COOKIE,
  SHARED_STAFF_ID,
  mintOsToken,
  osCookieOptions,
  verifyOsToken,
} from "@/lib/os-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const staffId = await verifyOsToken(token);
  if (staffId === null || staffId === SHARED_STAFF_ID) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "?error=sso";
    return NextResponse.redirect(login);
  }

  const next = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  const dest = request.nextUrl.clone();
  dest.pathname = next.startsWith("/") ? next : "/dashboard";
  dest.search = "";
  const res = NextResponse.redirect(dest);
  res.cookies.set(OS_COOKIE, await mintOsToken(staffId), osCookieOptions);
  return res;
}
