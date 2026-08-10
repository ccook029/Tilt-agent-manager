// POST   /api/push/subscribe   { subscription }  → save this device's push subscription
// DELETE /api/push/subscribe   { endpoint }      → remove it
// Signed-in staff only (the login-wall middleware). Ties the subscription to the
// staff id when known, so we could target individuals later.
import { NextRequest, NextResponse } from "next/server";
import { saveSubscription, removeSubscription, type PushSub } from "@/lib/push";
import { getCurrentStaff } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sub = (body as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } })
    .subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  const staff = await getCurrentStaff().catch(() => null);
  const record: PushSub = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    staffId: staff?.id,
    subscribedAt: new Date().toISOString(),
  };
  await saveSubscription(record);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const endpoint = (body as { endpoint?: string }).endpoint;
  if (endpoint) await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
