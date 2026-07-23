// ---------------------------------------------------------------------------
// /api/agents/voice-chat — real-time streaming voice reply.
//
// POST { message, agentId } → a streamed text/plain body: the agent's reply,
// token by token, so the client can start speaking the first sentence while the
// rest is still being written. Dispatches by agentId (chief-of-staff →
// company-wide Reese; else → the CFO). Same personas + KV transcripts as the
// typed chats. Auth: the CFO path is owner-gated; the Chief of Staff relies on
// the app's login-wall middleware (the general company assistant).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { streamVoiceReplyForAgent } from "@/lib/voice/voice-chat";
import { getCurrentStaff, isAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const message = (body as { message?: string }).message?.trim();
  const agentId = (body as { agentId?: string }).agentId?.trim() || "sterling";

  // The whole app is behind the login-wall middleware, so a signed-in user is
  // already vouched for. The CFO (finance) still gets its own owner gate; the
  // Chief of Staff is the general company assistant and relies on the wall —
  // don't double-gate it (getCurrentStaff() is null when the wall is off, which
  // must NOT 403 Reese). getCurrentStaff never throwing is belt-and-suspenders.
  if (agentId !== "chief-of-staff") {
    let staff = null;
    try {
      staff = await getCurrentStaff();
    } catch {
      /* fall through to the owner check with null */
    }
    if (!isAccountingOwner(staff)) {
      return NextResponse.json(
        { error: "Voice chat with the CFO is restricted to the accounting owner." },
        { status: 403 }
      );
    }
  }

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Non-streaming fallback (the client retries here if streaming failed). Same
  // brain, returned as one JSON block instead of a token stream.
  if ((body as { stream?: boolean }).stream === false) {
    try {
      const reply = await streamVoiceReplyForAgent(agentId, message, () => {});
      return NextResponse.json({
        reply: reply?.trim() || "I didn't catch that one — say it again?",
      });
    } catch (err) {
      console.error("[voice-chat] buffered error:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "voice reply failed" },
        { status: 500 }
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = false;
      try {
        await streamVoiceReplyForAgent(agentId, message, (delta) => {
          sent = true;
          controller.enqueue(encoder.encode(delta));
        });
        // Model returned nothing → still say something so it's not dead air.
        if (!sent) {
          controller.enqueue(encoder.encode("I didn't catch that one — say it again?"));
        }
      } catch (err) {
        console.error("[voice-chat] stream error:", err instanceof Error ? err.message : err);
        controller.enqueue(
          encoder.encode(" Sorry — I hit a snag just now. Try me again in a second.")
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no", // don't let a proxy buffer the stream
    },
  });
}
