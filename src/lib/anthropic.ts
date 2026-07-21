import { CLAUDE_MODEL, samplingParams } from "@/lib/models";
// ---------------------------------------------------------------------------
// anthropic.ts — Claude API caller with template variable substitution
// ---------------------------------------------------------------------------
import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    // reads ANTHROPIC_API_KEY from env. maxRetries above the SDK default (2):
    // a dispatch fires several worker+boss calls back-to-back, so a transient
    // 429/500/529 (overload / rate limit) is likely — the SDK backs off and
    // retries these, and a few extra attempts keeps a whole run from failing
    // just because the API was briefly busy.
    _client = new Anthropic({ maxRetries: 5 });
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
  /**
   * Give Claude Anthropic's server-side web search tool (real research on the
   * live web). Used by Business Development's Lead Researcher and Vetter. The
   * search runs on Anthropic's infrastructure and returns cited results in the
   * same response — we just read the final text. A number caps the searches.
   */
  webSearch?: boolean | number;
  /**
   * Images (screenshots, photos) shown to Claude alongside the user message —
   * base64 payloads, no data: prefix. Used by the employee chats so Chris can
   * paste a screenshot of what he's talking about.
   */
  images?: { mediaType: string; data: string }[];
  /**
   * PDF documents to attach to the user turn — base64, no data: prefix. Used by
   * Penny to read AP bills pulled from the Zoho Books Documents inbox.
   */
  documents?: { base64: string }[];
}

// Anthropic's server-side web search (dynamic filtering) — supported on our
// worker/boss models (Sonnet 5, Opus 4.8). GA, no beta header.
const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
const DEFAULT_WEB_SEARCH_MAX_USES = 6;

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
  const model = opts.model ?? CLAUDE_MODEL;

  // With images or PDFs attached, the user turn becomes media blocks + text.
  const hasMedia =
    (opts.images && opts.images.length > 0) ||
    (opts.documents && opts.documents.length > 0);
  const content: string | Anthropic.Messages.ContentBlockParam[] = hasMedia
    ? [
        ...(opts.images ?? []).map(
          (img): Anthropic.Messages.ContentBlockParam => ({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: img.data,
            },
          })
        ),
        ...(opts.documents ?? []).map(
          (doc): Anthropic.Messages.ContentBlockParam => ({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: doc.base64 },
          })
        ),
        { type: "text", text: opts.userMessage },
      ]
    : opts.userMessage;

  const basePayload = {
    model,
    max_tokens: opts.maxTokens ?? 4096,
    // Newer models (Sonnet 5, Opus 4.7/4.8) reject temperature — omit it there.
    ...samplingParams(model, opts.temperature ?? 0.4),
    system: opts.systemPrompt,
    messages: [{ role: "user" as const, content }],
  };

  // When MCP servers are supplied, use the beta mcp_servers connector so Claude
  // can call Zoho Books tools server-side. Each server must be referenced by an
  // mcp_toolset entry in the tools array (mcp-client-2025-11-20 spec). We rely
  // on the Zoho admin to expose READ tools only, so propose-only is enforced at
  // the source; you can additionally denylist write tools here via `configs`.
  // We cast loosely because the typed beta surface varies across SDK versions.
  let response: Anthropic.Messages.Message;
  if (opts.mcpServers && opts.mcpServers.length > 0) {
    const beta = client as unknown as {
      beta: { messages: { create: (p: unknown) => Promise<Anthropic.Messages.Message> } };
    };
    response = await beta.beta.messages.create({
      ...basePayload,
      mcp_servers: opts.mcpServers,
      tools: opts.mcpServers.map((s) => ({
        type: "mcp_toolset",
        mcp_server_name: s.name,
      })),
      betas: ["mcp-client-2025-11-20"],
    });
  } else if (opts.webSearch) {
    response = await runWithWebSearch(client, basePayload, opts);
  } else {
    response = (await client.messages.create(basePayload)) as Anthropic.Messages.Message;
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  if (!text.trim()) {
    // Diagnosable in the Vercel function logs when a caller sees a blank reply.
    console.warn(
      `[anthropic] ${model} returned no text — stop_reason=${response.stop_reason}, blocks=[${response.content.map((b) => b.type).join(",")}]`
    );
  }

  return {
    text,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    model,
  };
}

/**
 * Run a completion with Anthropic's server-side web search tool. Server tools
 * can stop with `stop_reason: "pause_turn"` when they hit their per-turn
 * iteration limit; to continue we re-send the assistant turn and let the server
 * resume (no extra user message). Token usage is summed across the resumes.
 */
async function runWithWebSearch(
  client: Anthropic,
  basePayload: Record<string, unknown>,
  opts: CallClaudeOptions
): Promise<Anthropic.Messages.Message> {
  const maxUses =
    typeof opts.webSearch === "number" ? opts.webSearch : DEFAULT_WEB_SEARCH_MAX_USES;
  const messages = [...(basePayload.messages as Anthropic.MessageParam[])];
  const tools = [
    { type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: maxUses },
  ];
  // The installed SDK types predate web_search_20260209; cast past them.
  const send = (msgs: Anthropic.MessageParam[]) =>
    client.messages.create({
      ...basePayload,
      messages: msgs,
      tools,
    } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming) as Promise<Anthropic.Messages.Message>;

  let response = await send(messages);
  let totalInput = response.usage?.input_tokens ?? 0;
  let totalOutput = response.usage?.output_tokens ?? 0;
  let guard = 0;
  while (response.stop_reason === "pause_turn" && guard < 4) {
    guard += 1;
    messages.push({ role: "assistant", content: response.content });
    response = await send(messages);
    totalInput += response.usage?.input_tokens ?? 0;
    totalOutput += response.usage?.output_tokens ?? 0;
  }

  // Report the summed usage across resumes on the final message.
  if (response.usage) {
    response.usage.input_tokens = totalInput;
    response.usage.output_tokens = totalOutput;
  }
  return response;
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
