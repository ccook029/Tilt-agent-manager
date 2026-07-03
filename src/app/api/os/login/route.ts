// ---------------------------------------------------------------------------
// POST /api/os/login — sign a staff member into the Tilt OS.
//
// Primary path: proxy {email, password} to tiltweb's POST /api/os/login
// (TILTWEB_URL), which verifies against the real admin_users directory and
// returns an OS token signed with the shared TILT_OS_SESSION_SECRET. We
// re-verify the token before trusting it, then set the session cookie.
//
// Transitional fallback: when TILTWEB_URL is not set (tiltweb endpoint not
// deployed yet), OS_SHARED_PASSCODE lets staff in as the shared identity
// (id 0, no per-person attribution). Remove the passcode once tiltweb's
// endpoint is live.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import {
  OS_COOKIE,
  SHARED_STAFF_ID,
  mintOsToken,
  osAuthEnabled,
  osCookieOptions,
  verifyOsToken,
} from "@/lib/os-auth";

export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest) {
  if (!osAuthEnabled()) {
    return fail(503, "OS login is not enabled — set TILT_OS_SESSION_SECRET.");
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return fail(400, "Password is required.");

  const tiltweb = process.env.TILTWEB_URL?.replace(/\/$/, "");

  if (tiltweb && email) {
    let res: Response;
    try {
      res = await fetch(`${tiltweb}/api/os/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return fail(502, "Could not reach the Tilt staff directory. Try again.");
    }
    if (!res.ok) return fail(401, "Invalid email or password.");
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      staff?: { id: number; name: string; email: string };
    };
    // Never trust a proxied token blindly — verify with the shared secret.
    const staffId = await verifyOsToken(data.token);
    if (!data.token || staffId === null || staffId === SHARED_STAFF_ID) {
      return fail(502, "Staff directory returned an invalid session token.");
    }
    const out = NextResponse.json({ ok: true, staff: data.staff ?? { id: staffId } });
    out.cookies.set(OS_COOKIE, data.token, osCookieOptions);
    return out;
  }

  // Fallback: shared passcode (pre-tiltweb-deploy bootstrap).
  const passcode = process.env.OS_SHARED_PASSCODE;
  if (!passcode) {
    return fail(
      email
        ? 503
        : 400,
      email
        ? "Per-person login needs TILTWEB_URL configured. Or leave email blank and use the shared passcode."
        : "Shared passcode login is not enabled — set OS_SHARED_PASSCODE (or configure TILTWEB_URL for per-person login).",
    );
  }
  if (password !== passcode) return fail(401, "Invalid passcode.");

  const token = await mintOsToken(SHARED_STAFF_ID);
  const out = NextResponse.json({
    ok: true,
    staff: { id: SHARED_STAFF_ID, name: "Tilt Staff", email: "" },
  });
  out.cookies.set(OS_COOKIE, token, osCookieOptions);
  return out;
}
