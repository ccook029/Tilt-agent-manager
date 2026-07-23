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
import { loadAgentChat, appendAgentChat } from "@/lib/agent-chat-store";
import { renderOrgKnowledge } from "@/lib/org-knowledge";
import { getOpenEscalations } from "@/lib/policy-ledger";
import { getRunLogsByAgent, getRunLogs } from "@/lib/store";
import { getEmployeeProfile } from "@/lib/org/employee-configs";
import { CLAUDE_MODEL } from "@/lib/models";

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

// ===========================================================================
// Chief of Staff (Reese Calder) — the WHOLE-COMPANY voice.
//
// Sterling knows finance; Reese knows everything. This path grounds him in a
// compact, fast, company-wide snapshot — the freshest output from every
// function plus the founders' decision queue — so "where are we at with R&D /
// what shipped / what needs me" gets a real cross-department answer. Persists
// to the same generic KV transcript as his typed chat (agent-chat:chief-of-staff).
// ===========================================================================

const CHIEF_VOICE_DIRECTIVE = `

=== LIVE VOICE CONVERSATION (you're being spoken to and heard aloud) ===
Chris walked into HQ and is talking to you out loud — your reply is READ ALOUD
in real time. You see the whole company (the snapshot below is the freshest read
from every function). Match HIS energy and how he talks: direct, fast, and
genuinely fun to talk to.
- Sound like a sharp, upbeat right-hand who happens to run the whole operation —
  high energy, quick, a little personality and wit. NOT a stiff corporate
  assistant. Use contractions and plain, punchy words.
- Get to the point in the FIRST sentence. Lead with the answer or the one thing
  that actually matters. No preamble, no "great question," no throat-clearing.
- 1–3 short spoken sentences, max. If there's more, give the headline out loud
  and offer the rest — don't monologue.
- Have a point of view. It's fine to be blunt, to have an opinion, to crack a
  quick line. Say the uncomfortable thing first, not buried.
- NO markdown, headings, bullet lists, or code — it's read out literally. Speak
  numbers naturally ("about twelve grand," not a table).
- Ground everything in the snapshot. If you don't actually know, say so fast and
  offer to get it — don't invent. For deep finance, hand it to Sterling.`;

/** Fast, company-wide grounding: freshest output per function + open decisions.
 *  One KV read for all run logs — no slow live-Zoho assembly. */
async function buildCompanySnapshot(): Promise<string> {
  const [logs, open] = await Promise.all([
    getRunLogs().catch(() => [] as { agentName: string; startedAt: string; output: string }[]),
    getOpenEscalations().catch(() => [] as { question: string }[]),
  ]);

  const seen = new Set<string>();
  const latest = [...logs]
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""))
    .filter((l) => (seen.has(l.agentName) ? false : (seen.add(l.agentName), true)))
    .slice(0, 12)
    .map((l) => {
      const firstLine = (l.output.split("\n").find((s) => s.trim()) ?? "").slice(0, 180);
      return `- ${l.agentName} (${l.startedAt.slice(0, 10)}): ${firstLine}`;
    })
    .join("\n");

  const decisions =
    open.length === 0
      ? "No open decisions waiting on the founders right now."
      : `${open.length} decision(s) waiting on the founders: ` +
        open.slice(0, 5).map((e) => e.question).join("; ");

  return `## Company snapshot — freshest read from each function
${latest || "(no recent agent activity on file)"}

## Founders' decision queue
${decisions}`;
}

/**
 * Stream Reese's spoken, company-wide reply. Same streaming + persistence
 * pattern as Sterling, but with the whole-company snapshot and the generic
 * (agent-chat) transcript.
 */
export async function streamChiefOfStaffVoiceReply(
  message: string,
  onDelta: (delta: string) => void
): Promise<string> {
  const [stored, orgKnowledge, snapshot] = await Promise.all([
    loadAgentChat("chief-of-staff").catch(() => ({ messages: [] as { role: "user" | "assistant"; content: string }[] })),
    renderOrgKnowledge().catch(() => ""),
    buildCompanySnapshot(),
  ]);

  const profile = getEmployeeProfile("chief-of-staff");
  const base =
    profile?.systemPrompt ??
    profile?.managerSystemPrompt ??
    "You are Reese Calder, Chief of Staff at Tilt Hockey Inc., working for the founders Chris and Jeremy.";

  const systemPrompt = base + orgKnowledge + CHIEF_VOICE_DIRECTIVE;

  const historyBlock =
    stored.messages.length === 0
      ? "(this is the start of today's conversation)"
      : stored.messages
          .slice(-8)
          .map((m) => `${m.role === "user" ? "Chris" : "Reese"}: ${m.content.slice(0, 800)}`)
          .join("\n");

  const userMessage = `${snapshot}

## Conversation so far
${historyBlock}

## Chris just said (out loud)
${message}`;

  const res = await streamClaudeText(
    { systemPrompt, userMessage, model: CLAUDE_MODEL, maxTokens: 700, temperature: 0.4 },
    onDelta
  );

  await appendAgentChat("chief-of-staff", message, res.text || "(no reply)").catch(() => {});
  return res.text;
}

/** Route a voice turn to the right agent brain. */
export function streamVoiceReplyForAgent(
  agentId: string,
  message: string,
  onDelta: (delta: string) => void
): Promise<string> {
  if (agentId === "chief-of-staff") return streamChiefOfStaffVoiceReply(message, onDelta);
  return streamSterlingVoiceReply(message, onDelta); // default: the CFO
}
