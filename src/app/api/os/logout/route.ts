// POST /api/os/logout — clear the Tilt OS session cookie on this browser.
import { NextResponse } from "next/server";
import { OS_COOKIE } from "@/lib/os-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(OS_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
