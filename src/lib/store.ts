// ---------------------------------------------------------------------------
// store.ts — Persistent storage for agent run logs using Vercel KV
//
// Uses Vercel KV (Upstash Redis) for production persistence.
// Logs survive deployments and are available across all serverless functions.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import type { AgentRunLog } from "./types";
import { sendPush } from "./push";

const LOG_KEY = "agent-run-logs";
const MAX_LOGS = 500;

/** Append one or more run logs. */
export async function saveRunLogs(newLogs: AgentRunLog[]): Promise<void> {
  const existing = await kv.get<AgentRunLog[]>(LOG_KEY) ?? [];
  const merged = [...existing, ...newLogs];
  const trimmed = merged.slice(-MAX_LOGS);
  await kv.set(LOG_KEY, trimmed);
  void notifyRunLogs(newLogs);
}

/** Ping the phone when an agent finishes work (or a run errors). Best-effort. */
async function notifyRunLogs(logs: AgentRunLog[]): Promise<void> {
  if (logs.length === 0) return;
  try {
    if (logs.length === 1) {
      const l = logs[0];
      await sendPush({
        title: l.agentName,
        body:
          l.status === "error"
            ? "A run failed — tap to check."
            : "Finished a run — tap to view.",
        url: "/activity",
        tag: `run-${l.id}`,
      });
    } else {
      await sendPush({
        title: "Tilt HQ",
        body: `${logs.length} agent updates are in.`,
        url: "/activity",
        tag: "runs",
      });
    }
  } catch {
    /* best-effort */
  }
}

/** Retrieve all stored run logs (most recent first). */
export async function getRunLogs(): Promise<AgentRunLog[]> {
  const logs = await kv.get<AgentRunLog[]>(LOG_KEY);
  return (logs ?? []).slice().reverse();
}

/** Retrieve logs for a specific agent. */
export async function getRunLogsByAgent(agentId: string): Promise<AgentRunLog[]> {
  const logs = await getRunLogs();
  return logs.filter((l) => l.agentId === agentId);
}
