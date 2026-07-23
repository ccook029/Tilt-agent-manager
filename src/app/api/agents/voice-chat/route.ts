// ---------------------------------------------------------------------------
// /api/agents/voice-chat — real-time streaming voice reply from Sterling (CFO).
//
// POST { message } → a streamed text/plain body: Sterling's reply, token by
// token, so the client can start speaking the first sentence while the rest is
// still being written. Same agent, persona, and KV transcript as the typed CFO
// chat (see streamSterlingVoiceReply). Restricted to the accounting owner, like
// the rest of the CFO console.
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

  const staff = await getCurrentStaff();
  // The Chief of Staff is the founders' agent — any signed-in staff (they're
  // already past the login wall). The CFO console stays owner-only.
  if (agentId === "chief-of-staff") {
    if (!staff) {
      return NextResponse.json({ error: "Sign in to talk to the Chief of Staff." }, { status: 403 });
    }
  } else if (!isAccountingOwner(staff)) {
    return NextResponse.json(
      { error: "Voice chat with the CFO is restricted to the accounting owner." },
      { status: 403 }
    );
  }

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamVoiceReplyForAgent(agentId, message, (delta) => {
          controller.enqueue(encoder.encode(delta));
        });
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
