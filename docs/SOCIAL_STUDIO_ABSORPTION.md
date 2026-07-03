# Social Studio Absorption Plan (Tilt OS Phase 3)

**Date:** 2026-07-03 · **Status:** Plan — no code moves yet
**Subject:** `tilt-social-media-manager` ("Social Studio") → a module of the
Tilt OS (this repo), per the platform audit's Phase 3 ("absorb the
satellites").

---

## What Social Studio is today

A self-hosted planning + content-generation agent for Tilt Hockey:

- **Stack:** Next.js 15 (App Router), Node 22, Drizzle ORM on Postgres
  (Neon/Supabase/Vercel Postgres), Vercel Blob for assets, Anthropic SDK
  (planning brain: `claude-opus-4-8`; vision tagging: Sonnet), Gemini
  "Nano Banana Pro" for static renders, Zoho WorkDrive as the photo source.
- **Data:** `assets` (tagged catalog), `posts`, `plan_skeleton` (rolling
  6-month plan), `kb_config` (versioned brand knowledge), `gaps` (shot list).
- **Pages:** `/` (roadmap), `/catalog`, `/plan`, `/posts`, `/gaps`, `/setup`.
- **Auth:** an optional `ADMIN_TOKEN` header gate on mutating admin routes;
  no login. Phases 5–7 of its own roadmap (portal auth, weekly email,
  publisher) are unbuilt.
- **Federation already in place:** launch card from the hub
  (`/api/modules/launch?m=social` + `SOCIAL_APP_URL`), and as of this
  branch it **pushes signals** (plan regenerated / catalog synced / visuals
  rendered) into the hub's `/api/signals` inbox → Morning Brief.

## Why absorb it (and why the order below)

- **One front door, one login, one brief** — the OS promise. Social work
  should surface next to finance/inventory attention items, not on a
  separate URL with a separate token.
- **Vercel cost** — each satellite is its own Vercel project with its own
  builds. Folding Social Studio into the hub deletes a project and its
  build pipeline entirely (fewer deployments, one preview per change).
  Given build costs are already a pain point, this is a real saving —
  **but until the merge, keep its branch deploys off** so pushes don't
  trigger satellite builds.
- **Shared primitives** — personas, `AgentChat`, org memory, the action
  audit. The studio's brain becomes an agent like Penny/Stockton instead
  of a parallel app.

Absorption is Phase 3 for a reason: it should land **after** the OS login
(so the merged module inherits real auth) and after the federation layer
(already done). Meanwhile the signals push keeps the two apps loosely
coupled with zero shared code.

## Stack deltas to reconcile

| Concern | Hub (this repo) | Social Studio | Resolution |
|---|---|---|---|
| Next.js | 16 | 15 | Upgrade studio pages to 16 during the move (App Router in both; low risk) |
| Persistence | Vercel KV blobs | Postgres + Drizzle | **Keep Postgres** for social data; the hub gains a `drizzle` dep scoped to the social module. Don't force posts/assets into KV. |
| Assets | — | Vercel Blob | Keep; move the Blob store binding to the hub project |
| Models | Central `src/lib/models.ts` | `ANTHROPIC_BRAIN_MODEL` / `ANTHROPIC_VISION_MODEL` envs | Fold into `models.ts` (audit P0 #3) |
| Claude client | `callClaude` (one caller) | Own Anthropic client w/ structured output + caching | Extend `callClaude` with a structured-output option rather than keeping a second client |
| Node | Vercel default | pinned 22.x | Align hub project to 22 first |
| Auth | none → OS login | `ADMIN_TOKEN` | OS login replaces both |

## The plan — four stages, each shippable

### Stage 1 — Shared login (prerequisite, from OS_LOGIN_DESIGN.md)
Social Studio gets the OS verifier + middleware; `ADMIN_TOKEN` is retired.
No absorption yet — but from here every stage happens behind real auth.

### Stage 2 — Surface before code (cheap OS feel)
- Hub's Social module card shows live status (next 7 days of posts,
  open gaps) by calling two small read-only studio endpoints, or simply by
  rendering its recent signals — already flowing.
- Studio's "needs review" count joins the hub's attention center /
  `/questions` mental model: reviewing next week's posts is a Chris-task
  like answering CFO questions.
- Add a **"Sydney" (or chosen name) social persona** to `personas.ts` so
  the brief can attribute social updates the way it does other agents.

### Stage 3 — The code move
1. Create `src/app/social/` in this repo; port pages (`catalog`, `plan`,
   `posts`, `gaps`, `setup`) under it, and API routes under
   `src/app/api/social/*`. Keep the studio's lib layout:
   `src/lib/social/{db,brain,planner,render,catalog,workdrive,blob}`.
2. Bring Drizzle config + migrations across unchanged (same database —
   **no data migration needed**; the tables move with their connection
   string `DATABASE_URL`/`POSTGRES_URL` into the hub project's env).
3. Merge env vars into the hub project (`GEMINI_API_KEY`,
   `BLOB_READ_WRITE_TOKEN`, `ZOHO_WORKDRIVE_*`; the Zoho *WorkDrive* OAuth
   client is separate from the hub's Books/Inventory client — keep both).
4. Replace the HTTP signals client with a direct import of
   `src/lib/signals.ts#postSignal` (delete `TILT_HQ_URL` indirection).
5. Wire the planning brain into the OS: plan generation becomes a
   dispatchable task in the cron roster (weekly), its run logged via
   `saveRunLogs` so it appears in the Morning Brief natively; give the
   persona `AgentChat` ("why is Tuesday's post a gap?").
6. Long-running routes (`maxDuration 300`) keep their limits; check the
   hub's Vercel plan allows them (studio already relies on this today).
7. Update `/api/modules/launch`: `m=social` now routes to `/social`
   in-app; remove `SOCIAL_APP_URL`/`SOCIAL_ACCESS_KEY`.

### Stage 4 — Decommission
- Redirect the old `tilt-social-media-manager.vercel.app` domain to
  `<hub>/social`, pause then delete the Vercel project (build-cost win
  realized here), archive the repo with a pointer note in its README.

## Risks & mitigations

- **Next 15 → 16 breakage** — small surface (a handful of pages, no
  middleware today); do the upgrade inside the hub PR where CI/typecheck
  covers it.
- **Bundle/dep weight** (`sharp`, `postgres`, `drizzle-orm` join the hub) —
  server-only deps; route-level code splitting keeps dashboard pages
  unaffected.
- **One deploy, blast radius up** — a bad social deploy now redeploys HQ.
  Mitigation: the hub finally gets tests (audit item #9) before Stage 3;
  social's brain calls are behind admin-triggered routes, not cron-critical
  paths, at first.
- **Two databases in one app** (KV + Postgres) — accepted permanently;
  they serve different shapes (event blobs vs relational content plan).

## Explicit non-goals

- Absorbing tiltweb — only its **staff login** participates in the OS
  (see OS_LOGIN_DESIGN.md); the storefront stays its own site and project.
- Building Social Studio's unbuilt phases (publisher, weekly email) during
  the move — absorb first, then build them on OS primitives (Resend is
  already in the hub).
- tiltinventory absorption — same recipe applies later; it's smaller and
  should follow once this one proves the pattern.

## Sequencing snapshot

| # | Step | Size | Depends on |
|---|---|---|---|
| 1 | OS login in hub + studio | S–M | tiltweb `/api/os/login` |
| 2 | Social module card + persona + attention surfacing | S | signals (done) |
| 3 | Code move into `src/app/social/` | L | 1, hub tests |
| 4 | Decommission satellite project | S | 3 |
