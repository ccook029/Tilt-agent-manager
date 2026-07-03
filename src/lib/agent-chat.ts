// ---------------------------------------------------------------------------
// agent-chat.ts — talk to any agent (audit item #12).
//
// Gives every non-accounting agent the same "chat with memory" Sterling and
// Penny already have: their persona/system prompt, the shared company
// knowledge, and their own most-recent reports as grounding, with a persistent
// transcript. "Talk to Stockton: why is INT 18K out of stock?" now works.
// ---------------------------------------------------------------------------
import { callClaude } from "./anthropic";
import { CLAUDE_MODEL } from "./models";
import { getAgentById } from "./agent-registry";
import { getRunLogsByAgent } from "./store";
import { renderOrgKnowledge } from "./org-knowledge";
import { loadAgentChat, appendAgentChat } from "./agent-chat-store";

// Agents with a dedicated, richer chat surface of their own — the generic
// path stays out of their way.
const DEDICATED = new Set(["accounting-manager", "accounting", "product-design"]);

export function isChattable(agentId: string): boolean {
  return Boolean(getAgentById(agentId)) && !DEDICATED.has(agentId);
}

export interface AgentChatTurn {
  reply: string;
}

export async function runAgentConversation(
  agentId: string,
  message: string,
  clientHistory: { role: "user" | "assistant"; content: string }[] = []
): Promise<AgentChatTurn> {
  const config = getAgentById(agentId);
  if (!config) throw new Error(`Unknown agent: ${agentId}`);

  const stored = await loadAgentChat(agentId).catch(() => ({ messages: [] }));
  const history = stored.messages.length ? stored.messages : clientHistory;

  const logs = await getRunLogsByAgent(agentId).catch(() => []);
  const reports =
    logs
      .slice(0, 3)
      .map(
        (l) =>
          `### ${l.agentName} — ${l.startedAt.slice(0, 10)} (${l.status})\n${l.output.slice(0, 4000)}`
      )
      .join("\n\n---\n\n") || "(no reports produced yet — say what you'd run to find out)";

  const historyBlock =
    history
      .slice(-12)
      .map((m) => `${m.role === "user" ? "Team" : config.name}: ${m.content.slice(0, 1500)}`)
      .join("\n\n") || "(no prior messages)";

  const systemPrompt = config.systemPrompt + (await renderOrgKnowledge().catch(() => ""));

  const userMessage = `You are ${config.name}, chatting live with the Tilt team (Chris, Jeremy, or staff). Answer their message directly and specifically, grounded in your recent work below and what you know about Tilt. If you don't have the data, say exactly what you'd run or need — don't invent numbers. Keep it conversational and tight; this is a chat, not an email.

## Your most recent reports
${reports}

## Conversation so far
${historyBlock}

## Their message
${message}`;

  const res = await callClaude({
    systemPrompt,
    userMessage,
    model: config.model ?? CLAUDE_MODEL,
    maxTokens: 1600,
    temperature: 0.4,
  });

  await appendAgentChat(agentId, message, res.text).catch(() => {});
  return { reply: res.text };
}
