// ---------------------------------------------------------------------------
// manager.ts — Summarises combined agent outputs via Claude
// ---------------------------------------------------------------------------
import Anthropic from "@anthropic-ai/sdk";
import type { AgentRunLog, ManagerSummary } from "./types";

const MANAGER_MODEL = "claude-sonnet-4-20250514";

const MANAGER_SYSTEM_PROMPT = `You are the Manager Agent for Tilt Hockey Inc.
You receive the outputs of multiple specialist AI agents that ran today.
Your job is to:
1. Summarise the key findings and action items from each agent.
2. Flag anything urgent or that needs human attention.
3. Provide a brief executive summary (3-5 bullet points).

Be concise, professional, and action-oriented.`;

export async function summariseResults(
  logs: AgentRunLog[]
): Promise<ManagerSummary> {
  const client = new Anthropic();

  const agentOutputs = logs
    .map(
      (log) =>
        `### ${log.agentName} (${log.status})\n${log.output}`
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: MANAGER_MODEL,
    max_tokens: 2048,
    temperature: 0.3,
    system: MANAGER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here are today's agent outputs:\n\n${agentOutputs}`,
      },
    ],
  });

  const summary = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  return {
    timestamp: new Date().toISOString(),
    agentResults: logs.map((l) => ({
      agentId: l.agentId,
      agentName: l.agentName,
      status: l.status,
    })),
    summary,
  };
}
