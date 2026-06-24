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

export interface McpServer {
  type: "url";
  url: string;
  name: string;
  authorization_token?: string;
}

export interface CallClaudeOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Remote MCP servers to expose to Claude via Anthropic's mcp_servers
   * connector (server-side tool discovery + execution). Used by the Accounting
   * team to drive the Zoho Books MCP. When omitted, a plain text completion
   * runs — so callers that pre-fetch data via REST keep working unchanged.
   */
  mcpServers?: McpServer[];
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

  const basePayload = {
    model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.4,
    system: opts.systemPrompt,
    messages: [{ role: "user" as const, content: opts.userMessage }],
  };

  // When MCP servers are supplied, use the beta mcp_servers connector so Claude
  // can call Zoho Books tools server-side. We cast loosely because the typed
  // surface for this beta varies across SDK minor versions.
  let response: Anthropic.Messages.Message;
  if (opts.mcpServers && opts.mcpServers.length > 0) {
    const beta = client as unknown as {
      beta: { messages: { create: (p: unknown) => Promise<Anthropic.Messages.Message> } };
    };
    response = await beta.beta.messages.create({
      ...basePayload,
      mcp_servers: opts.mcpServers,
      betas: ["mcp-client-2025-04-04"],
    });
  } else {
    response = (await client.messages.create(basePayload)) as Anthropic.Messages.Message;
  }

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
