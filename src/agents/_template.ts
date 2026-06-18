// ---------------------------------------------------------------------------
// Agent Config Template
//
// To create a new agent:
//   1. Copy this file to src/agents/<your-agent-id>.ts
//   2. Fill in the config below
//   3. Import and register it in src/lib/agent-registry.ts
//   4. (Optional) Add a dedicated cron entry in vercel.json
// ---------------------------------------------------------------------------
import type { AgentConfig } from "@/lib/types";

const agent: AgentConfig = {
  id: "your-agent-id",
  name: "Your Agent Name",
  schedule: "0 8 * * *", // daily at 8 AM UTC

  systemPrompt: `You are a specialist agent for Tilt Hockey Inc.
Your role is: [describe role here].
Be concise and actionable in your output.`,

  userPrompt: `[Your user prompt here. Can also be a function that returns
a string, e.g. to inject today's date.]`,

  // Optional overrides:
  // model: "claude-sonnet-4-6",
  // maxTokens: 2048,
  // temperature: 0.7,
  // tags: ["category"],
  // emailSubject: "Custom email subject",
  // enabled: true,
};

export default agent;
