// ---------------------------------------------------------------------------
// /api/org/work-orders/[id] — Inspect and act on one work order
//
// GET  → the full work order (rounds, reviews, escalation ids)
// POST { action: "run" | "ship" | "send_back" | "reject", notes?, by? }
//   - run:       execute the worker → boss cycle (queued/revision only)
//   - ship:      THE OWNER'S APPROVE TRIGGER — marks boss-approved work shipped
//   - send_back: return it with notes; it re-runs as a new revision round
//   - reject:    kill it
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getWorkOrder } from "@/lib/org/work-orders";
import {
  rejectWorkOrder,
  runWorkOrder,
  sendBackWorkOrder,
  shipWorkOrder,
} from "@/lib/org/engine";

export const maxDuration = 300;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = await getWorkOrder(id);
  if (!order) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }
  return NextResponse.json({ order });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      notes?: string;
      by?: string;
    };

    switch (body.action) {
      case "run": {
        const { order, tokens } = await runWorkOrder(id);
        return NextResponse.json({ ok: true, order, tokens });
      }
      case "ship": {
        const order = await shipWorkOrder(id, body.by, body.notes);
        return NextResponse.json({ ok: true, order });
      }
      case "send_back": {
        if (!body.notes?.trim()) {
          return NextResponse.json(
            { error: "send_back requires notes — tell the team what to change." },
            { status: 400 }
          );
        }
        const order = await sendBackWorkOrder(id, body.notes, body.by);
        return NextResponse.json({ ok: true, order });
      }
      case "reject": {
        const order = await rejectWorkOrder(id, body.notes, body.by);
        return NextResponse.json({ ok: true, order });
      }
      default:
        return NextResponse.json(
          { error: 'action must be one of "run", "ship", "send_back", "reject".' },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error(`[api] org/work-orders/${id} action failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
