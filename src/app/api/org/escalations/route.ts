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
    const policy = await resolveEscalation(
      body.departmentId,
      body.escalationId,
      body.answer.trim(),
      body.answeredBy
    );
    if (!policy) {
      return NextResponse.json(
        { error: `Escalation not found: ${body.escalationId}` },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, policy });
  } catch (err) {
    console.error("[api] org/escalations POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
