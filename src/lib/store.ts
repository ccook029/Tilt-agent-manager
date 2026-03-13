// ---------------------------------------------------------------------------
// store.ts — Lightweight persistence for agent run logs
//
// Uses a JSON file on disk for local dev.  For production on Vercel (which has
// an ephemeral filesystem), swap this out for Vercel KV, Upstash Redis, or a
// database.  The interface is intentionally simple so the swap is painless.
// ---------------------------------------------------------------------------
import fs from "fs/promises";
import path from "path";
import type { AgentRunLog } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const LOG_FILE = path.join(DATA_DIR, "run-logs.json");

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

async function readLogs(): Promise<AgentRunLog[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    return JSON.parse(raw) as AgentRunLog[];
  } catch {
    return [];
  }
}

async function writeLogs(logs: AgentRunLog[]) {
  await ensureDataDir();
  await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2));
}

/** Append one or more run logs. */
export async function saveRunLogs(newLogs: AgentRunLog[]): Promise<void> {
  const existing = await readLogs();
  const merged = [...existing, ...newLogs];
  // Keep only the most recent 500 entries to avoid unbounded growth.
  const trimmed = merged.slice(-500);
  await writeLogs(trimmed);
}

/** Retrieve all stored run logs (most recent first). */
export async function getRunLogs(): Promise<AgentRunLog[]> {
  const logs = await readLogs();
  return logs.reverse();
}

/** Retrieve logs for a specific agent. */
export async function getRunLogsByAgent(agentId: string): Promise<AgentRunLog[]> {
  const logs = await readLogs();
  return logs.filter((l) => l.agentId === agentId).reverse();
}
