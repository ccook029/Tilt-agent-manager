// ---------------------------------------------------------------------------
// Pipeline: Weekly social content plan — the Social Studio brain on the cron.
//
// Regenerates the 6-month skeleton and re-resolves the locked 14-day window
// (one Claude call per slot, so this is the most expensive scheduled task).
// Opt-in: runs only when SOCIAL_PLAN_CRON=true AND a database is configured;
// otherwise it reports "skipped" so the cron stays green.
// ---------------------------------------------------------------------------
import { saveRunLogs } from "@/lib/store";
import { CLAUDE_MODEL } from "@/lib/models";
import { isDemoMode } from "@/lib/social/demo-data";
import { generatePlan, clearGeneratedPlan } from "@/lib/social/planner/generate";

export async function runSocialPlanWeekly() {
  const startedAt = new Date();

  if (process.env.SOCIAL_PLAN_CRON !== "true") {
    return { skipped: "SOCIAL_PLAN_CRON is not enabled" };
  }
  if (isDemoMode()) {
    return { skipped: "no database configured (demo mode)" };
  }

  await clearGeneratedPlan();
  const summary = await generatePlan();

  const finishedAt = new Date();
  const output = [
    `Weekly content plan regenerated.`,
    `- Skeleton: ${summary.skeletonWeeks} weeks`,
    `- Locked window: ${summary.slots} slots → ${summary.postsWritten} platform posts drafted (needs review)`,
    `- Asset gaps flagged: ${summary.gapsFlagged}`,
    summary.errors.length
      ? `- Errors: ${summary.errors.length} slot(s) failed (${summary.errors
          .slice(0, 3)
          .map((e) => e.date)
          .join(", ")}${summary.errors.length > 3 ? ", …" : ""})`
      : `- Errors: none`,
    ``,
    `Review queue: /studio/social/posts`,
  ].join("\n");

  await saveRunLogs([
    {
      id: `social-plan-${startedAt.toISOString()}`,
      agentId: "social-studio",
      agentName: "Tilt Social Studio (Weekly Plan)",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: summary.errors.length === summary.slots && summary.slots > 0 ? "error" : "success",
      output,
      model: process.env.ANTHROPIC_BRAIN_MODEL ?? CLAUDE_MODEL,
    },
  ]);

  return { summary };
}
