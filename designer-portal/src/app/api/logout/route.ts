import { NextResponse } from "next/server";
import { PORTAL_COOKIE, portalCookieOptions } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PORTAL_COOKIE, "", { ...portalCookieOptions, maxAge: 0 });
  return res;
}
