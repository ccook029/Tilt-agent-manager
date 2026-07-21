import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_COOKIE, verifyPortalToken } from "@/lib/auth";

// Everything is gated behind the portal session except the login page, the
// login API, and static assets. The portal fails CLOSED: with no
// PORTAL_PASSCODE configured, verifyPortalToken always returns false and the
// login page explains what's missing. (proxy.ts is Next 16's name for
// middleware.ts — it runs on every matched request at the edge.)

const PUBLIC_PATHS = new Set(["/login", "/api/login"]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const user = await verifyPortalToken(req.cookies.get(PORTAL_COOKIE)?.value);
  if (user !== null) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next internals and static files (anything with a file extension).
  matcher: ["/((?!_next/|favicon\\.ico|brand/|fonts/).*)"],
};
