// ---------------------------------------------------------------------------
// models.ts — Single source of truth for the Claude model every agent uses.
//
// A model retirement once took the whole platform down because the ID was
// hardcoded in 14 files. Now migration is one env var (CLAUDE_MODEL in
// Vercel) or one line here.
// ---------------------------------------------------------------------------
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

/**
 * Model used for MANAGER review passes in the Org OS department engine.
 * Bosses judge work rather than produce it, so they can run a stronger model
 * than the workers. Defaults to CLAUDE_MODEL; override with
 * CLAUDE_MANAGER_MODEL in Vercel when you want smarter reviews.
 */
export const CLAUDE_MANAGER_MODEL =
  process.env.CLAUDE_MANAGER_MODEL ?? CLAUDE_MODEL;
