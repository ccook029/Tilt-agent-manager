// ---------------------------------------------------------------------------
// agent-chat-store.ts — persistent chat memory for any agent (Vercel KV).
//
// The generic counterpart to cfo-chat-store: one transcript per agentId, so
// "Talk to Stockton", "Talk to Dana", etc. survive reloads. Capped to the last
// MAX messages to keep prompt size + cost bounded (no LLM summarization here;
// the accounting chats keep that heavier treatment).
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const keyFor = (agentId: string) => `agent-chat:${agentId}`;
const MAX_MESSAGES = 40;

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface AgentChatState {
  messages: ChatMsg[];
}

export async function loadAgentChat(agentId: string): Promise<AgentChatState> {
  return (await kv.get<AgentChatState>(keyFor(agentId))) ?? { messages: [] };
}

export async function appendAgentChat(
  agentId: string,
  user: string,
  assistant: string
): Promise<void> {
  const state = await loadAgentChat(agentId);
  const now = new Date().toISOString();
  const messages = [
    ...state.messages,
    { role: "user" as const, content: user, timestamp: now },
    { role: "assistant" as const, content: assistant, timestamp: now },
  ].slice(-MAX_MESSAGES);
  await kv.set(keyFor(agentId), { messages });
}

export async function clearAgentChat(agentId: string): Promise<void> {
  await kv.del(keyFor(agentId));
}
