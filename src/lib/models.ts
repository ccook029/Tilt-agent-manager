// ---------------------------------------------------------------------------
// models.ts — Single source of truth for the Claude model every agent uses.
//
// A model retirement once took the whole platform down because the ID was
// hardcoded in 14 files. Now migration is one env var (CLAUDE_MODEL in
// Vercel) or one line here.
// ---------------------------------------------------------------------------
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";
