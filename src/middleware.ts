// ---------------------------------------------------------------------------
// middleware.ts — the Tilt OS front door (docs/OS_LOGIN_DESIGN.md).
//
// Opt-in: enforcement turns on when TILT_OS_SESSION_SECRET is set, so a
// deploy without the env var behaves exactly as before (use Vercel
// Deployment Protection until then, per docs/PLATFORM_AUDIT.md P0 #1).
//
// Everything requires a valid tilt_os_session cookie except:
//   - /login and the /api/os/* auth endpoints themselves
//   - machine traffic that carries its own bearer secret (Vercel cron with
//     CRON_SECRET; satellite signal pushes with MODULES_SHARED_KEY) — those
//     routes keep verifying the bearer themselves, as today
//   - /api/hq-metrics, which is served CORS-open by design (vercel.json)
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { OS_COOKIE, osAuthEnabled, verifyOsToken } from "@/lib/os-auth";

const PUBLIC_PREFIXES = ["/login", "/api/os/", "/api/hq-metrics"];

export async function middleware(request: NextRequest) {
  if (!osAuthEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Machine-to-machine callers authenticate with their own bearer secrets;
  // let the routes do their existing checks.
  const auth = request.headers.get("authorization");
  if (auth) {
    const cron = process.env.CRON_SECRET;
    const modules = process.env.MODULES_SHARED_KEY;
    if (
      (cron && auth === `Bearer ${cron}`) ||
      (modules && auth === `Bearer ${modules}`)
    ) {
      return NextResponse.next();
    }
  }

  const staffId = await verifyOsToken(request.cookies.get(OS_COOKIE)?.value);
  if (staffId !== null) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized — Tilt OS staff sign-in required." },
      { status: 401 }
    );
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Skip static assets entirely.
  matcher: ["/((?!_next/static|_next/image|images|favicon.ico|icon|apple-icon).*)"],
};
