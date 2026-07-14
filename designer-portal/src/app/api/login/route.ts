import { NextResponse } from "next/server";
import {
  mintPortalToken,
  portalConfigured,
  portalCookieOptions,
  PORTAL_COOKIE,
  validateLogin,
} from "@/lib/auth";
import { tiltOsEnabled, tiltOsLogin } from "@/lib/tilt-os";

async function sessionResponse(user: string) {
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(PORTAL_COOKIE, await mintPortalToken(user), portalCookieOptions);
  return res;
}

export async function POST(req: Request) {
  if (!portalConfigured()) {
    return NextResponse.json(
      { error: "No logins are configured yet — set PORTAL_USERS (or PORTAL_PASSCODE) in the project settings." },
      { status: 503 }
    );
  }

  let email = "";
  let passcode = "";
  try {
    const body = (await req.json()) as { email?: string; passcode?: string };
    email = typeof body.email === "string" ? body.email : "";
    passcode = typeof body.passcode === "string" ? body.passcode : "";
  } catch {
    // fall through to the mismatch below
  }

  // Portal-only users (PORTAL_USERS / PORTAL_PASSCODE) first.
  const user = passcode ? validateLogin(email, passcode) : null;
  if (user) return sessionResponse(user);

  // Then existing Tilt OS staff credentials via tiltweb.
  if (tiltOsEnabled() && email && passcode) {
    const result = await tiltOsLogin(email, passcode);
    if (result.ok) return sessionResponse(result.email);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
}
