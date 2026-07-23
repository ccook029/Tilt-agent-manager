// ---------------------------------------------------------------------------
// /api/accounting-manager/run — Sterling Vance (CFO) interactions
//
// POST modes:
//   { "mode": "chat",   "message": "..." }                 → talk to the CFO
//   { "mode": "answer", "escalationId": "...", "answer": "..." }
//                                                           → answer an open
//                                                             question; it
//                                                             becomes policy
//   { "mode": "digest", "email": true }                    → build/send the
//                                                             daily CFO digest
//
// GET → builds + emails the daily digest (used by the cron). The "Run Now"
// button on the dashboard also lands here (defaults to digest).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse, after } from "next/server";
import {
  runCfoChat,
  runPennyChat,
  runDispatchedTask,
  sendCfoDigestEmail,
  type CfoChatMessage,
} from "@/lib/accounting-loop";
import { loadCfoChat, clearCfoChat, type ChatAgent } from "@/lib/cfo-chat-store";
import {
  resolveEscalation,
  assignEscalation,
  getOpenEscalations,
  getEscalations,
  getPolicies,
} from "@/lib/policy-ledger";
import { SHARED_STAFF_ID } from "@/lib/os-auth";
import {
  getCurrentStaff,
  getStaffDirectory,
  isAccountingOwner,
  type StaffProfile,
} from "@/lib/os-identity";

export const maxDuration = 300;

// This whole route is the accounting owner's console (CFO/Penny chat, the
// decisions queue, digests, assignment). Everyone else is turned away here and
// uses /api/my-questions for questions delegated to them. The cron reaches the
// digest with its own bearer secret.
async function ownerGuard(
  request: NextRequest
): Promise<{ staff: StaffProfile } | NextResponse> {
  const auth = request.headers.get("authorization");
  if (
    auth &&
    process.env.CRON_SECRET &&
    auth === `Bearer ${process.env.CRON_SECRET}`
  ) {
    return { staff: { id: SHARED_STAFF_ID, name: "Cron", email: "" } };
  }
  const staff = await getCurrentStaff();
  if (!isAccountingOwner(staff)) {
    return NextResponse.json(
      { error: "The accounting console is restricted to the accounting owner." },
      { status: 403 }
    );
  }
  return { staff: staff ?? { id: SHARED_STAFF_ID, name: "Owner", email: "" } };
}

export async function GET(request: NextRequest) {
  const guard = await ownerGuard(request);
  if (guard instanceof NextResponse) return guard;
  return sendDigest(true);
}

export async function POST(request: NextRequest) {
  try {
    const guard = await ownerGuard(request);
    if (guard instanceof NextResponse) return guard;
    const currentStaff = guard.staff;

    const body = await request.json().catch(() => ({}));
    const { mode = "digest" } = body as { mode?: string };

    // Which agent's chat this concerns (Sterling by default; Penny has her
    // own window). They share the escalation queue and policy ledger.
    const agent: ChatAgent =
      (body as { agent?: string }).agent === "penny" ? "penny" : "sterling";

    if (mode === "list") {
      return NextResponse.json({ ok: true, open: await getOpenEscalations() });
    }

    if (mode === "list-all") {
      const all = await getEscalations();
      const policies = await getPolicies();
      return NextResponse.json({
        ok: true,
        open: all.filter((e) => e.status === "open"),
        resolved: all.filter((e) => e.status === "resolved").slice(-50).reverse(),
        policyCount: policies.length,
      });
    }

    if (mode === "history") {
      const state = await loadCfoChat(agent);
      return NextResponse.json({
        ok: true,
        summary: state.summary,
        messages: state.messages,
      });
    }

    if (mode === "clear-chat") {
      await clearCfoChat(agent);
      return NextResponse.json({ ok: true });
    }

    if (mode === "chat") {
      const { message, history = [], voice } = body as {
        message?: string;
        history?: CfoChatMessage[];
        /** Hands-free Voice Mode — reply is read aloud, so keep it concise. */
        voice?: boolean;
      };
      if (!message || !message.trim()) {
        return NextResponse.json({ error: "message is required" }, { status: 400 });
      }
      const chatFn = agent === "penny" ? runPennyChat : runCfoChat;
      const result = await chatFn(message, Array.isArray(history) ? history : [], {
        concise: Boolean(voice),
      });

      // Record any decisions Sterling extracted from Chris's message as policy.
      const recorded: string[] = [];
      for (const r of result.resolutions) {
        const policy = await resolveEscalation(r.id, r.answer, currentStaff.name);
        if (policy) recorded.push(policy.rule);
      }

      // Launch a dispatched task in the background — the reply returns
      // immediately; the run lands in Penny's Report History when done.
      if (result.dispatch) {
        const task = result.dispatch;
        after(async () => {
          await runDispatchedTask(task);
        });
      }

      return NextResponse.json({
        ok: true,
        reply: result.reply,
        dispatched: result.dispatch,
        recordedPolicies: recorded,
        open: await getOpenEscalations(),
      });
    }

    if (mode === "answer") {
      const { escalationId, answer } = body as {
        escalationId?: string;
        answer?: string;
      };
      if (!escalationId || !answer?.trim()) {
        return NextResponse.json(
          { error: "escalationId and answer are required" },
          { status: 400 }
        );
      }
      const policy = await resolveEscalation(escalationId, answer, currentStaff.name);
      if (!policy) {
        return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        recorded: true,
        policy,
        open: await getOpenEscalations(),
      });
    }

    if (mode === "directory") {
      // Who the owner can delegate questions to.
      return NextResponse.json({ ok: true, staff: await getStaffDirectory() });
    }

    if (mode === "assign") {
      const { escalationId, assigneeEmail, assigneeName, unassign } = body as {
        escalationId?: string;
        assigneeEmail?: string;
        assigneeName?: string;
        unassign?: boolean;
      };
      if (!escalationId) {
        return NextResponse.json(
          { error: "escalationId is required" },
          { status: 400 }
        );
      }
      if (!unassign && !assigneeEmail?.trim()) {
        return NextResponse.json(
          { error: "assigneeEmail is required to assign" },
          { status: 400 }
        );
      }
      const updated = await assignEscalation(
        escalationId,
        unassign
          ? null
          : {
              email: assigneeEmail!.trim(),
              name: (assigneeName ?? assigneeEmail!).trim(),
            },
        currentStaff.name
      );
      if (!updated) {
        return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, escalation: updated });
    }

    // default: digest
    const { email = true } = body as { email?: boolean };
    return sendDigest(email);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[accounting-manager/run] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function sendDigest(email: boolean) {
  const { body, openCount } = await sendCfoDigestEmail(email);
  return NextResponse.json({ ok: true, openCount, digest: body, emailSent: email });
}
