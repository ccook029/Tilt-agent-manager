// ---------------------------------------------------------------------------
// /api/org/escalations — Department escalation queues (the owner's inbox)
//
// GET  ?department=marketing → that department's open questions
//      (no param → open questions across every department)
// POST { departmentId, escalationId, answer, answeredBy? }
//      Resolves the question AND records the answer as standing department
//      policy — the "never ask twice" pathway.
//
// Finance's queue is the same data the existing /questions page manages
// (org/ledger.ts maps finance to the legacy accounting KV keys).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getDepartments, getDepartmentById } from "@/lib/org/directory";
import { getOpenEscalations, resolveEscalation } from "@/lib/org/ledger";
import { listWorkOrders } from "@/lib/org/work-orders";
import { runWorkOrder, sendBackWorkOrder } from "@/lib/org/engine";

// Answering can resume the work it unblocked, which runs the engine.
export const maxDuration = 300;

/**
 * Put every work order this escalation was blocking back to work.
 *
 * A work order records the escalations it raised (`escalationIds`), so the link
 * exists — nothing was walking it. The answer also lands in the department's
 * policy ledger, which the worker prompt already includes, so the redo sees the
 * decision rather than asking again.
 *
 * Best-effort per order: one that fails to restart is left in "revision", where
 * the stalled-work sweep and the Resume button both pick it up.
 */
async function resumeOrdersBlockedBy(
  escalationId: string,
  answer: string,
  answeredBy = "Chris Cook"
): Promise<{ id: string; title: string; status: string }[]> {
  const blocked = (
    await listWorkOrders({ status: ["escalated"], limit: 100 }).catch(() => [])
  ).filter((o) => o.escalationIds.includes(escalationId));

  const out: { id: string; title: string; status: string }[] = [];
  for (const order of blocked) {
    try {
      await sendBackWorkOrder(order.id, `You asked, I answered: ${answer}`, answeredBy);
      const done = await runWorkOrder(order.id);
      out.push({ id: order.id, title: order.title, status: done.order.status });
    } catch (err) {
      console.error(`[escalations] couldn't resume ${order.id}:`, err);
      out.push({ id: order.id, title: order.title, status: "revision" });
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  const departmentId = request.nextUrl.searchParams.get("department");
  if (departmentId) {
    if (!getDepartmentById(departmentId)) {
      return NextResponse.json(
        { error: `Unknown department: ${departmentId}` },
        { status: 404 }
      );
    }
    const open = await getOpenEscalations(departmentId);
    return NextResponse.json({
      escalations: open.map((e) => ({ ...e, departmentId })),
    });
  }

  const all = await Promise.all(
    getDepartments().map(async (d) =>
      (await getOpenEscalations(d.id).catch(() => [])).map((e) => ({
        ...e,
        departmentId: d.id,
        departmentName: d.name,
      }))
    )
  );
  return NextResponse.json({ escalations: all.flat() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      departmentId?: string;
      escalationId?: string;
      answer?: string;
      answeredBy?: string;
    };
    if (!body.departmentId || !body.escalationId || !body.answer?.trim()) {
      return NextResponse.json(
        { error: "departmentId, escalationId, and answer are required." },
        { status: 400 }
      );
    }
    const answer = body.answer.trim();
    const policy = await resolveEscalation(
      body.departmentId,
      body.escalationId,
      answer,
      body.answeredBy
    );
    if (!policy) {
      return NextResponse.json(
        { error: `Escalation not found: ${body.escalationId}` },
        { status: 404 }
      );
    }

    // Answering the question is only half of it. The work order that RAISED it
    // is sitting in "escalated" and, until now, stayed there — so the founder
    // answered in one queue and the work never moved in the other. Resume
    // whatever this unblocked, carrying the answer as the owner's note.
    const resumed = await resumeOrdersBlockedBy(
      body.escalationId,
      answer,
      body.answeredBy
    );

    return NextResponse.json({ ok: true, policy, resumed });
  } catch (err) {
    console.error("[api] org/escalations POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
