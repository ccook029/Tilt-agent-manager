// ---------------------------------------------------------------------------
// email.ts — Send agent output emails via Resend
// ---------------------------------------------------------------------------
import { Resend } from "resend";
import type { ManagerSummary } from "./types";

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  return new Resend(apiKey);
}

/**
 * Send the manager summary as an email digest.
 */
export async function sendDigestEmail(summary: ManagerSummary): Promise<void> {
  const from = process.env.EMAIL_FROM ?? "agents@tiltsports.com";
  const to = process.env.EMAIL_TO ?? "admin@tiltsports.com";

  const agentList = summary.agentResults
    .map((r) => `  - ${r.agentName}: ${r.status}`)
    .join("\n");

  const resend = getResendClient();

  await resend.emails.send({
    from,
    to,
    subject: `[Tilt Agents] Daily Digest — ${new Date().toLocaleDateString()}`,
    text: [
      "Tilt Agent Orchestrator — Daily Digest",
      "=".repeat(44),
      "",
      "Agents that ran:",
      agentList,
      "",
      "Executive Summary:",
      summary.summary,
    ].join("\n"),
  });
}

/**
 * Send a single agent's output as an email (useful for per-agent alerts).
 */
export async function sendAgentEmail(
  agentName: string,
  output: string,
  subject?: string
): Promise<void> {
  const from = process.env.EMAIL_FROM ?? "agents@tiltsports.com";
  const to = process.env.EMAIL_TO ?? "admin@tiltsports.com";

  const resend = getResendClient();

  await resend.emails.send({
    from,
    to,
    subject: subject ?? `[Tilt Agents] ${agentName} — Output`,
    text: output,
  });
}
