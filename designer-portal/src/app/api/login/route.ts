import { NextResponse } from "next/server";
import {
  mintPortalToken,
  portalConfigured,
  portalCookieOptions,
  PORTAL_COOKIE,
  validateLogin,
} from "@/lib/auth";

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

  const user = passcode ? validateLogin(email, passcode) : null;
  if (!user) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(PORTAL_COOKIE, await mintPortalToken(user), portalCookieOptions);
  return res;
}
