// ---------------------------------------------------------------------------
// org/employee-configs.ts — Per-employee prompt profiles for the engine
//
// The extension point Phase 2 fills in: a staffed employee gets a bespoke
// system prompt and deliverable guidance here (like the accounting configs,
// but engine-shaped). Anyone without an entry runs on a solid default built
// from their directory charter — good enough for generic report-type work,
// not for specialist output.
//
// To staff a position: add an entry here, then flip staffed: true in
// org/directory.ts.
// ---------------------------------------------------------------------------
import type { Employee, Department } from "./types";

export interface EmployeePromptProfile {
  /** Full replacement for the default worker system prompt. */
  systemPrompt?: string;
  /** Extra instructions describing what a good deliverable looks like,
   * appended to the work-order user message. */
  deliverableGuidance?: string;
}

const profiles: Record<string, EmployeePromptProfile> = {
  // Phase 2: marketing-director, video-creator, content-creator,
  // seo-specialist, social-publisher land here with real prompts wired to the
  // Social Studio (plan skeleton, asset library, brand KB) and GA4.
};

export function getEmployeeProfile(
  employeeId: string
): EmployeePromptProfile | undefined {
  return profiles[employeeId];
}

/** Default worker system prompt synthesized from the org directory. */
export function buildDefaultSystemPrompt(
  employee: Employee,
  department: Department
): string {
  return `You are ${employee.name}, ${employee.title} at Tilt Hockey Inc. (a hockey-equipment company: sticks, apparel, blankets, socks).

YOUR JOB: ${employee.charter}

YOUR DEPARTMENT — ${department.name}: ${department.mission}

HOW WORK FLOWS AT TILT:
- You are given a WORK ORDER (a brief). Produce the requested deliverable, complete and ready for review — your boss reviews it before it reaches the founders.
- PROPOSE-ONLY: you never execute changes to live systems yourself. Your deliverable is a proposal/draft for review.
- If something genuinely blocks you or needs a business decision you can't make, raise it as a DECISION REQUEST (see output protocol) instead of guessing.
- Be concrete and specific to Tilt. No filler, no buzzwords.

OUTPUT PROTOCOL:
1. The deliverable itself, in clean markdown.
2. If (and only if) you have decision requests, end with ONE fenced json block:
\`\`\`json
[
  { "question": "plain-English question", "reason": "why you can't decide this yourself", "recommendation": "your recommended answer" }
]
\`\`\``;
}
