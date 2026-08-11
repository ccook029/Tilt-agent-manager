// GET  /api/accounting/questions            → Penny's open questions (with context)
// POST /api/accounting/questions { escalationId, approve? , answer? }
//        approve:true → run the action the question was holding (post / apply /
//                       match) AND record the decision as standing policy
//        answer:"..."  → record the decision as standing policy only
//
// This is what makes the desk work: an answer here DOES the thing, so Chris
// never has to re-read a report, switch to chat, and re-run a batch.
import { NextRequest, NextResponse } from "next/server";
import {
  getOpenEscalations,
  resolveEscalation,
  dismissEscalation,
} from "@/lib/policy-ledger";
import { executeProposedAction, sweepAnsweredQuestions } from "@/lib/accounting-execute";
import { getCurrentStaff } from "@/lib/os-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ open: await getOpenEscalations() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { escalationId, approve, answer, action } = body as {
    escalationId?: string;
    approve?: boolean;
    answer?: string;
    action?: "sweep" | "dismiss";
  };

  // Penny re-reads the whole queue against standing policy and closes what's
  // already been decided — the fix for questions piling up after the answer
  // was already given.
  if (action === "sweep") {
    const result = await sweepAnsweredQuestions();
    return NextResponse.json({ ok: true, ...result, open: await getOpenEscalations() });
  }

  if (!escalationId) {
    return NextResponse.json({ error: "escalationId is required" }, { status: 400 });
  }

  if (action === "dismiss") {
    const staffNow = await getCurrentStaff().catch(() => null);
    const ok = await dismissEscalation(
      escalationId,
      "Dismissed by Chris — no rule needed",
      staffNow?.name ?? "Chris Cook"
    );
    return NextResponse.json({
      ok,
      dismissed: ok,
      open: await getOpenEscalations(),
    });
  }

  const open = await getOpenEscalations();
  const esc = open.find((e) => e.id === escalationId);
  if (!esc) {
    return NextResponse.json({ error: "question not found or already answered" }, { status: 404 });
  }

  const staff = await getCurrentStaff().catch(() => null);
  const who = staff?.name ?? "Chris Cook";

  // Run the held action first — if it fails, don't record a policy that claims
  // something happened.
  let actionSummary: string | null = null;
  if (approve && esc.context?.proposedAction) {
    try {
      actionSummary = await executeProposedAction(esc.context);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 422 }
      );
    }
  }

  const decision =
    answer?.trim() ||
    (actionSummary
      ? `Approved: ${esc.context?.affirmativeLabel ?? "go ahead"}. ${actionSummary}`
      : "Approved.");
  const policy = await resolveEscalation(escalationId, decision, who);

  return NextResponse.json({
    ok: true,
    actionSummary,
    rule: policy?.rule ?? null,
    open: await getOpenEscalations(),
  });
}
