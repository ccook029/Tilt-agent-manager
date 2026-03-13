// ---------------------------------------------------------------------------
// anthropic.ts — Claude API caller with template variable substitution
// ---------------------------------------------------------------------------
import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  }
  return _client;
}

export interface CallClaudeOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call the Claude API and return the text response.
 */
export async function callClaude(
  opts: CallClaudeOptions
): Promise<ClaudeResponse> {
  const client = getClient();
  const model = opts.model ?? "claude-sonnet-4-20250514";

  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.4,
    system: opts.systemPrompt,
    messages: [{ role: "user", content: opts.userMessage }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  return {
    text,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    model,
  };
}

/**
 * Replace {{variable}} placeholders in a template string.
 * Supports {{#if variable}}...{{/if}} conditional blocks.
 */
export function substituteVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;

  // Handle {{#if variable}}content{{/if}} blocks
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, content: string) => {
      const value = variables[varName];
      if (value && value.trim()) {
        // Substitute variables inside the block too
        return content.replace(
          /\{\{(\w+)\}\}/g,
          (_m: string, key: string) => variables[key] ?? ""
        );
      }
      return "";
    }
  );

  // Handle plain {{variable}} substitutions
  result = result.replace(
    /\{\{(\w+)\}\}/g,
    (_match, varName: string) => variables[varName] ?? ""
  );

  return result;
}
