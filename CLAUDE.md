# Tilt Corporate HQ — Tilt-agent-manager

Next.js 16 (App Router) hub for Tilt Hockey's internal "Tilt OS": AI agents
(Stockton Ledger — inventory, CFO strategist, social, catalog, orchestrator),
the Stick Order Builder, Design/Social Studio, Staff Tools, Files, Knowledge,
and the org-wide signals feed. Deployed on Vercel.

## Branching & deployment — IMPORTANT

- **`main` is the canonical branch. Branch from `main`; open PRs against
  `main`.** Production deploys from `main`.
- The old long-lived production branch `claude/ai-agent-orchestrator-B9e4U`
  is **retired** as of July 2026 — `main` was created from its tip
  (`da47be4`) and everything moved over. Do NOT base new work on it or merge
  into it.
- Same convention as the tiltweb repo (its `claude/*-live` branches were
  retired the same way).
- Merges use squash. When a PR's base moved underneath you, rebase with
  `git rebase --onto origin/main <old-parent> <branch>` rather than merging
  the base in — squash merges make stale-base merges conflict-heavy. Always
  start new work from a freshly fetched `origin/main`.

## Cross-app wiring (tiltweb ↔ hub)

- Shared bearer key both directions: `MODULES_SHARED_KEY` (must match the
  tiltweb env). Hub → tiltweb base URL: `NEXT_PUBLIC_TILTWEB_URL` (production
  is `https://www.tilthockey.com`); tiltweb → hub: `TILT_HQ_URL` on tiltweb.
- **Gotcha:** `fetch()` strips the Authorization header on cross-origin
  redirects (apex → www). Use the manual-redirect pattern in
  `src/lib/order-builder/data.ts` (`fetchWithKey`) for any authed call to
  tiltweb.
- tiltweb feeds the hub: pending custom orders
  (`GET {tiltweb}/api/modules/custom-orders`), signals
  (`POST /api/signals` here), staff-tools calls. Deploy order matters when a
  hub feature depends on a new tiltweb endpoint: promote tiltweb first.

## Conventions

- Agent personas/registry: `src/lib/personas.ts`, `src/lib/agent-registry.ts`;
  chat context assembly in `src/lib/agent-chat.ts` (persona + org knowledge +
  cross-agent signals + per-agent extras, e.g. Stockton gets
  `renderOrderBuilderContext()`).
- Stick Order Builder: isomorphic allocator + economics in
  `src/lib/order-builder/allocator.ts`; live dataset (Zoho sheet + tiltweb
  custom queue) in `data.ts`; explainability in `logic.ts` — keep
  `ALLOCATOR_METHODOLOGY` in sync with allocator changes.
- Zoho stick sheet parsing: custom tabs have no serial column — pass
  `requireSerial: false` or rows silently drop to zero.
- Announcement graphics: partner graphic is 100% code-composited
  (`src/lib/social/announce/compose.ts`, sharp); ambassador graphic is a
  Gemini image steered by the brief in `generate.ts` with code-stamped marks.
- PDFs via `@react-pdf/renderer` (`src/lib/pdf.tsx`); Playwright chromium at
  `/opt/pw-browsers` for email-image rendering.
