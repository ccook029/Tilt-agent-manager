// ---------------------------------------------------------------------------
// agent-registry.ts — Auto-discovers agent configs from src/agents/
// ---------------------------------------------------------------------------
import type { AgentConfig } from "./types";

/**
 * Registry of all agent configs.
 *
 * To add a new agent, create a file in src/agents/<agent-id>.ts that
 * default-exports an AgentConfig, then import and register it below.
 *
 * We use explicit imports (rather than dynamic fs-based discovery) because
 * Next.js edge/serverless bundles don't support runtime fs scanning.
 */
const registry: AgentConfig[] = [];

// --- Register agents here -------------------------------------------------
// import exampleAgent from "@/agents/example-agent";
// registry.push(exampleAgent);
// --------------------------------------------------------------------------

export function getAllAgents(): AgentConfig[] {
  return registry.filter((a) => a.enabled !== false);
}

export function getAgentById(id: string): AgentConfig | undefined {
  return registry.find((a) => a.id === id);
}

export function registerAgent(config: AgentConfig): void {
  const existing = registry.findIndex((a) => a.id === config.id);
  if (existing !== -1) {
    registry[existing] = config;
  } else {
    registry.push(config);
  }
}

export function getAgentsDueNow(): AgentConfig[] {
  // For the cron-based architecture every agent in the registry that is
  // enabled is considered "due" when its cron endpoint fires.  Fine-grained
  // schedule matching happens at the Vercel cron layer (vercel.json) — each
  // agent can have its own cron path, or they all share the catch-all
  // /api/cron/run-agents route and we filter here.
  return getAllAgents();
}
