import { CLAUDE_MODEL, samplingParams } from "@/lib/models";
// ---------------------------------------------------------------------------
// agent-runner.ts — Executes a single agent against the Claude API
// ---------------------------------------------------------------------------
import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, AgentRunLog } from "./types";

const DEFAULT_MODEL = CLAUDE_MODEL;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.7;

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  }
  return _client;
}

/**
 * Run a single agent and return a structured log entry.
 */
export async function runAgent(config: AgentConfig): Promise<AgentRunLog> {
  const startedAt = new Date();
  const model = config.model ?? DEFAULT_MODEL;
  const userPrompt =
    typeof config.userPrompt === "function"
      ? config.userPrompt()
      : config.userPrompt ?? "Run your scheduled task now.";

  try {
    const client = getClient();
    const response = await client.messages.create({
      model,
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...samplingParams(model, config.temperature ?? DEFAULT_TEMPERATURE),
      system: config.systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const finishedAt = new Date();
    const output = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n\n");

    return {
      id: `${config.id}-${startedAt.toISOString()}`,
      agentId: config.id,
      agentName: config.name,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: "success",
      output,
      model,
      tokensUsed:
        (response.usage?.input_tokens ?? 0) +
        (response.usage?.output_tokens ?? 0),
    };
  } catch (err) {
    const finishedAt = new Date();
    return {
      id: `${config.id}-${startedAt.toISOString()}`,
      agentId: config.id,
      agentName: config.name,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: "error",
      output: err instanceof Error ? err.message : String(err),
      model,
    };
  }
}
