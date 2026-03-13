// ---------------------------------------------------------------------------
// orchestrator.ts — Top-level "run everything" logic
// ---------------------------------------------------------------------------
import { getAllAgents, getAgentById } from "./agent-registry";
import { runAgent } from "./agent-runner";
import { summariseResults } from "./manager";
import { saveRunLogs } from "./store";
import { sendDigestEmail } from "./email";
import type { AgentRunLog, ManagerSummary } from "./types";

export interface OrchestratorResult {
  logs: AgentRunLog[];
  summary: ManagerSummary | null;
  emailSent: boolean;
}

/**
 * Run all enabled agents, summarise via manager, save logs, send email.
 */
export async function runAllAgents(): Promise<OrchestratorResult> {
  const agents = getAllAgents();
  if (agents.length === 0) {
    return { logs: [], summary: null, emailSent: false };
  }

  // Run all agents concurrently
  const logs = await Promise.all(agents.map((agent) => runAgent(agent)));

  // Save logs
  await saveRunLogs(logs);

  // Summarise via manager layer
  let summary: ManagerSummary | null = null;
  try {
    summary = await summariseResults(logs);
  } catch (err) {
    console.error("[orchestrator] Manager summarisation failed:", err);
  }

  // Send email digest
  let emailSent = false;
  if (summary && process.env.RESEND_API_KEY) {
    try {
      await sendDigestEmail(summary);
      emailSent = true;
    } catch (err) {
      console.error("[orchestrator] Email send failed:", err);
    }
  }

  return { logs, summary, emailSent };
}

/**
 * Run a single agent by ID.
 */
export async function runSingleAgent(
  agentId: string
): Promise<AgentRunLog | null> {
  const config = getAgentById(agentId);
  if (!config) return null;

  const log = await runAgent(config);
  await saveRunLogs([log]);
  return log;
}
