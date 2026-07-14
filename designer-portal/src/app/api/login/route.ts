import { NextResponse } from "next/server";
import {
  mintPortalToken,
  portalConfigured,
  portalCookieOptions,
  PORTAL_COOKIE,
  safeEqual,
} from "@/lib/auth";

export async function POST(req: Request) {
  if (!portalConfigured()) {
    return NextResponse.json(
      { error: "The portal passcode isn't configured yet — set PORTAL_PASSCODE in the project settings." },
      { status: 503 }
    );
  }

  let passcode = "";
  try {
    const body = (await req.json()) as { passcode?: string };
    passcode = typeof body.passcode === "string" ? body.passcode : "";
  } catch {
    // fall through to the mismatch below
  }

  if (!passcode || !safeEqual(passcode, process.env.PORTAL_PASSCODE!)) {
    return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PORTAL_COOKIE, await mintPortalToken(), portalCookieOptions);
  return res;
}
