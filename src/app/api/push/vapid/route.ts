// GET /api/push/vapid — the public VAPID key the client subscribes with.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  return NextResponse.json(
    { publicKey, configured: Boolean(publicKey) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
