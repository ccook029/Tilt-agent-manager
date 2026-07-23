// ---------------------------------------------------------------------------
// voice-chat.ts — the SNAPPY, streaming path for talking to Sterling out loud.
//
// Same agent, same persona (cfoConfig.systemPrompt), same KV transcript as the
// typed CFO chat — but tuned for real-time conversation:
//   • LIGHT context: company knowledge + open decisions + Penny's latest
//     headlines (all fast KV reads). It deliberately SKIPS the heavy live-Zoho
//     assembly (strategist projections, AP inbox) that makes the typed chat
//     thorough-but-slow. Sterling can offer to pull deep numbers on the typed
//     chat when a question needs them.
//   • STREAMS the reply token-by-token so the client can start speaking the
//     first sentence while the rest is still being written.
//   • SHORT, spoken answers (1–3 sentences, no markdown).
//
// Persists through the shared persistCfoChatTurn, so a voice turn lands in the
// exact same transcript as typing — no separate history.
// ---------------------------------------------------------------------------
import cfoConfig from "@/agents/accounting-manager.config";
import { streamClaudeText } from "@/lib/anthropic";
import { persistCfoChatTurn } from "@/lib/accounting-loop";
import { loadCfoChat } from "@/lib/cfo-chat-store";
import { renderOrgKnowledge } from "@/lib/org-knowledge";
import { getOpenEscalations } from "@/lib/policy-ledger";
import { getRunLogsByAgent } from "@/lib/store";

const VOICE_DIRECTIVE = `

=== LIVE VOICE CONVERSATION (you are being spoken to and heard aloud) ===
Chris has walked in and is talking to you, his chief of staff, out loud — your
reply is READ ALOUD in real time, not shown on screen. So:
- Talk like a sharp colleague across the desk. Warm, direct, human.
- Keep it to 1–3 short spoken sentences. Lead with the answer, then at most one
  key number or next step. If he wants more, he'll ask.
- NO markdown, headings, bullet lists, tables, or code — it all gets read out
  literally. Speak numbers naturally ("about twelve grand," not a table).
- If a question truly needs deep live financials you don't have in front of you,
  say so in a sentence and offer to pull it up in the full chat — don't guess.
- End on a natural hand-back when useful ("want me to dig into that?").`;

/** Fast, KV-only grounding so Sterling knows the state of things without the
 *  slow live-Zoho assembly. */
async function buildVoiceSnapshot(): Promise<string> {
  const [open, pennyLogs] = await Promise.all([
    getOpenEscalations().catch(() => [] as { question: string }[]),
    getRunLogsByAgent("accounting").catch(() => [] as { agentName: string; startedAt: string; output: string }[]),
  ]);

  const decisions =
    open.length === 0
      ? "No open decisions waiting on Chris right now."
      : `${open.length} decision(s) waiting on Chris: ` +
        open.slice(0, 4).map((e) => e.question).join("; ");

  // Freshest report per task, first line only — enough to speak to "where we're at".
  const seen = new Set<string>();
  const headlines = pennyLogs
    .filter((l) => (seen.has(l.agentName) ? false : (seen.add(l.agentName), true)))
    .slice(0, 3)
    .map((l) => {
      const firstLine = (l.output.split("\n").find((s) => s.trim()) ?? "").slice(0, 220);
      return `- ${l.agentName} (${l.startedAt.slice(0, 10)}): ${firstLine}`;
    })
    .join("\n");

  return `## Current state (quick snapshot)
${decisions}
${headlines ? `\nPenny's latest findings:\n${headlines}` : ""}`;
}

/**
 * Stream Sterling's spoken reply. `onDelta` fires per token chunk; resolves with
 * the full text once done (and after the turn is saved to the shared KV chat).
 */
export async function streamSterlingVoiceReply(
  message: string,
  onDelta: (delta: string) => void
): Promise<string> {
  const [stored, orgKnowledge, snapshot] = await Promise.all([
    loadCfoChat("sterling"),
    renderOrgKnowledge().catch(() => ""),
    buildVoiceSnapshot(),
  ]);

  const historyBlock = [
    stored.summary ? `Summary of earlier conversation:\n${stored.summary}` : "",
    stored.messages.length === 0
      ? "(this is the start of today's conversation)"
      : stored.messages
          .slice(-8)
          .map((m) => `${m.role === "user" ? "Chris" : "Sterling"}: ${m.content.slice(0, 800)}`)
          .join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = cfoConfig.systemPrompt + orgKnowledge + VOICE_DIRECTIVE;

  const userMessage = `${snapshot}

## Conversation so far
${historyBlock}

## Chris just said (out loud)
${message}`;

  const res = await streamClaudeText(
    {
      systemPrompt,
      userMessage,
      model: cfoConfig.model,
      maxTokens: 700,
      temperature: 0.4,
    },
    onDelta
  );

  // Same transcript as the typed chat.
  await persistCfoChatTurn("sterling", message, res.text || "(no reply)");
  return res.text;
}
