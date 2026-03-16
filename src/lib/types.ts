// ---------------------------------------------------------------------------
// Core types for the Tilt Agent Orchestrator
// ---------------------------------------------------------------------------

/** Cron schedule expression (standard 5-field cron or Vercel shorthand) */
export type CronSchedule = string;

/**
 * AgentConfig — drop one of these into src/agents/ to register a new agent.
 *
 * Required fields:
 *  - id:          Unique slug (kebab-case).  Also used as the filename stem.
 *  - name:        Human-readable label shown in the dashboard.
 *  - schedule:    Cron expression that determines when the agent runs.
 *  - systemPrompt: The system prompt sent to Claude for this agent.
 *  - userPrompt:  The user-turn prompt (can be a static string or a function
 *                 that returns a string, e.g. to inject today's date).
 *
 * Optional:
 *  - model:       Claude model to use (defaults to claude-sonnet-4-20250514).
 *  - maxTokens:   Max response tokens (defaults to 2048).
 *  - temperature: Sampling temperature (defaults to 0.7).
 *  - tags:        Arbitrary labels for filtering / grouping in the dashboard.
 *  - emailSubject: Override the default email subject line for this agent.
 *  - enabled:     Set to false to skip execution without removing the file.
 */
export interface AgentConfig {
  id: string;
  name: string;
  schedule?: CronSchedule;
  systemPrompt: string;
  userPrompt?: string | (() => string);
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tags?: string[];
  emailSubject?: string;
  enabled?: boolean;
}

/** The result of a single agent run, persisted for the dashboard. */
export interface AgentRunLog {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;   // ISO-8601
  finishedAt: string;   // ISO-8601
  durationMs: number;
  status: "success" | "error";
  output: string;       // Claude's response (or error message)
  model: string;
  tokensUsed?: number;
}

/** Payload returned by the manager summarisation step. */
export interface ManagerSummary {
  timestamp: string;
  agentResults: { agentId: string; agentName: string; status: string }[];
  summary: string;
}
