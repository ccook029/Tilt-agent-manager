// ---------------------------------------------------------------------------
// /api/accounting/stuck-orders — the hub's side of Penny's stuck-order queue.
//
// GET  → the list, straight from tiltweb
// POST → { paymentIntentId } re-runs that order's Zoho sync
//
// A thin proxy on purpose: the shared key lives on the server, so the browser
// never sees it, and the list rule stays defined in one place (tiltweb) rather
// than being re-derived here.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { fetchStuckOrders, retryOrderSync, describeRetry } from "@/lib/stuck-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const result = await fetchStuckOrders();
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: NextRequest) {
  let body: { paymentIntentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON." }, { status: 400 });
  }

  const id = String(body.paymentIntentId ?? "").trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "paymentIntentId is required." },
      { status: 400 }
    );
  }

  const outcome = await retryOrderSync(id);
  return NextResponse.json({ ...outcome, message: describeRetry(outcome) });
}
