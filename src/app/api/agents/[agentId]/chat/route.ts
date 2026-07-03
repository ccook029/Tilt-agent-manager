// ---------------------------------------------------------------------------
// /api/agents/[agentId]/chat — talk to any (non-accounting) agent.
//   POST { mode: "chat", message } → { reply }
//   POST { mode: "history" }       → { messages }
//   POST { mode: "clear" }         → { ok }
// Signed-in staff only (the middleware login wall). Accounting agents use
// their own /api/accounting-manager/run chat; this rejects them.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { isChattable, runAgentConversation } from "@/lib/agent-chat";
import { loadAgentChat, clearAgentChat } from "@/lib/agent-chat-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await ctx.params;
  if (!isChattable(agentId)) {
    return NextResponse.json(
      { error: `${agentId} isn't available for chat here.` },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const mode = (body as { mode?: string }).mode ?? "chat";

  if (mode === "history") {
    const state = await loadAgentChat(agentId).catch(() => ({ messages: [] }));
    return NextResponse.json({ ok: true, messages: state.messages });
  }
  if (mode === "clear") {
    await clearAgentChat(agentId).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const { message, history = [] } = body as {
    message?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  if (!message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const result = await runAgentConversation(agentId, message, history);
    return NextResponse.json({ ok: true, reply: result.reply });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed." },
      { status: 500 }
    );
  }
}
