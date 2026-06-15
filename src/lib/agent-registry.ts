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
import websiteAnalytics from "@/agents/website-analytics-agent.config";
import competitorIntel from "@/agents/competitor-intel-agent.config";
import competitorSocial from "@/agents/competitor-social-agent.config";
import materialsRd from "@/agents/materials-rd-agent.config";
import productDesign from "@/agents/product-design-agent.config";
import tiltDesign from "@/agents/tilt-design-agent.config";
import inventory from "@/agents/inventory-agent.config";

const registry: AgentConfig[] = [
  websiteAnalytics as unknown as AgentConfig,
  competitorIntel as unknown as AgentConfig,
  competitorSocial as unknown as AgentConfig,
  materialsRd as unknown as AgentConfig,
  productDesign as unknown as AgentConfig,
  tiltDesign as unknown as AgentConfig,
  inventory as unknown as AgentConfig,
];

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
