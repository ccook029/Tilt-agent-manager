import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PORTAL_COOKIE, verifyPortalToken } from "@/lib/auth";

// Who am I? The proxy already gates this route, so a null here only happens
// in a race with cookie expiry.
export async function GET() {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  const user = await verifyPortalToken(token);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json({ user });
}
