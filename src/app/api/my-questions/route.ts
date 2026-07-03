// ---------------------------------------------------------------------------
// /api/my-questions — questions delegated to the signed-in staff member.
//
// This is the ONE accounting-adjacent surface a non-owner may use. It never
// exposes the full queue: it only returns questions whose assignee email
// matches the caller's session, and it only lets them answer those. Answering
// resolves the question and records it as policy under their name — exactly
// like the owner answering, just scoped to their assignments.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/os-identity";
import {
  getEscalations,
  getEscalationsAssignedTo,
  resolveEscalation,
} from "@/lib/policy-ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  if (!staff.email) {
    // We know the id but not the email (e.g. arrived via SSO). Ask them to
    // sign in with email so we can match assignments.
    return NextResponse.json({ ok: true, needsEmail: true, questions: [] });
  }
  return NextResponse.json({
    ok: true,
    staff,
    questions: await getEscalationsAssignedTo(staff.email),
  });
}

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in with your email to answer assigned questions." },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { escalationId, answer } = body as { escalationId?: string; answer?: string };
  if (!escalationId || !answer?.trim()) {
    return NextResponse.json(
      { error: "escalationId and answer are required" },
      { status: 400 }
    );
  }

  // Authorization: you may only answer a question assigned to YOU.
  const all = await getEscalations();
  const esc = all.find((e) => e.id === escalationId);
  if (!esc) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  if (esc.assigneeEmail?.toLowerCase() !== staff.email.toLowerCase()) {
    return NextResponse.json(
      { error: "That question isn't assigned to you." },
      { status: 403 }
    );
  }

  await resolveEscalation(escalationId, answer, staff.name);
  return NextResponse.json({
    ok: true,
    questions: await getEscalationsAssignedTo(staff.email),
  });
}
