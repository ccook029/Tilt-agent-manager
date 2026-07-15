// ---------------------------------------------------------------------------
// models.ts — Single source of truth for the Claude model every agent uses.
//
// A model retirement once took the whole platform down because the ID was
// hardcoded in 14 files. Now migration is one env var (CLAUDE_MODEL in
// Vercel) or one line here.
//
// Current tiers (2026-07): workers run Claude Sonnet 5 (near-Opus quality on
// content/agentic work at Sonnet cost); bosses review on Claude Opus 4.8.
// NOTE: if CLAUDE_MODEL is still pinned in Vercel env, it overrides these
// defaults — clear it or update it there too.
// ---------------------------------------------------------------------------
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";

/**
 * Model used for MANAGER review passes in the Org OS department engine.
 * Bosses judge work rather than produce it, so they run a stronger model
 * than the workers. Override with CLAUDE_MANAGER_MODEL in Vercel.
 */
export const CLAUDE_MANAGER_MODEL =
  process.env.CLAUDE_MANAGER_MODEL ?? "claude-opus-4-8";

/**
 * Claude Sonnet 5, Opus 4.7/4.8, and Fable/Mythos 5 REJECT non-default
 * sampling parameters (temperature/top_p/top_k) with a 400. Older models
 * still accept them. Every call site spreads this instead of passing
 * temperature directly, so switching model tiers can never 400 the platform.
 */
export function samplingParams(
  model: string,
  temperature: number | undefined
): { temperature?: number } {
  if (temperature === undefined) return {};
  const rejectsSampling = /opus-4-[78]|sonnet-5|fable|mythos/.test(model);
  return rejectsSampling ? {} : { temperature };
}
