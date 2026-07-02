// ---------------------------------------------------------------------------
// cfo-chat-store.ts — Persistent memory for the accounting chats (Vercel KV)
//
// One transcript per agent (Sterling and Penny). Conversations survive page
// reloads and devices. To keep the prompt (and cost) bounded, a history
// compacts instead of truncating: once it exceeds MAX_MESSAGES, the oldest
// messages are folded into a running SUMMARY that is always shown to the
// agent — decisions and numbers survive, verbatim chit-chat doesn't.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

export type ChatAgent = "sterling" | "penny";

const keyFor = (agent: ChatAgent) => `accounting-chat:${agent}`;

/** Compact when the stored transcript exceeds this many messages… */
export const MAX_MESSAGES = 40;
/** …keeping this many of the most recent messages verbatim. */
export const KEEP_RECENT = 24;

export interface StoredChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface CfoChatState {
  /** Rolling summary of everything compacted away. */
  summary: string;
  messages: StoredChatMessage[];
}

export async function loadCfoChat(agent: ChatAgent = "sterling"): Promise<CfoChatState> {
  return (await kv.get<CfoChatState>(keyFor(agent))) ?? { summary: "", messages: [] };
}

export async function saveCfoChat(
  state: CfoChatState,
  agent: ChatAgent = "sterling"
): Promise<void> {
  await kv.set(keyFor(agent), state);
}

export async function clearCfoChat(agent: ChatAgent = "sterling"): Promise<void> {
  await kv.del(keyFor(agent));
}

export function needsCompaction(state: CfoChatState): boolean {
  return state.messages.length > MAX_MESSAGES;
}

/** Split into (older → to summarize) and (recent → keep verbatim). */
export function splitForCompaction(state: CfoChatState): {
  older: StoredChatMessage[];
  recent: StoredChatMessage[];
} {
  return {
    older: state.messages.slice(0, state.messages.length - KEEP_RECENT),
    recent: state.messages.slice(-KEEP_RECENT),
  };
}
