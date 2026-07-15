# Tilt Org OS — from agents to employees

The redesign of the agent platform into a real company structure: departments
of specialist **employees**, each reporting to a **boss** who reviews their
work before it reaches the founders, with the **owner keeping the final
approve trigger** on everything that ships.

Decided with Chris on 2026-07-15:

- The publisher targets **Instagram, TikTok, and Facebook** (Phase 3).
- Every department pipeline runs through its boss, **but Chris keeps the
  approve trigger** until he's comfortable graduating a boss to ship on
  their own (the graduation counters in the policy ledger already track
  readiness).
- SEO covers **classic Google AND AI-search optimization** — making Tilt the
  answer ChatGPT, Claude, Perplexity, and Google AI Overviews give for
  hockey-gear questions. (Google Search Console access still to be confirmed.)

## Where it came from

The Finance team already proved this loop: Penny (Staff Accountant) does the
work and raises decision requests → Sterling (CFO) reviews, resolves what
policy covers, escalates only owner-level calls → Chris's answers become
permanent rules in the policy ledger, so nothing is asked twice
(`accounting-loop.ts`, `policy-ledger.ts`). The Org OS generalizes exactly
that pattern; Finance keeps its richer bespoke pipeline and shares its ledger
with the new system through key mapping.

## The pieces (Phase 1 — built)

| Piece | File | What it is |
|---|---|---|
| Org model | `src/lib/org/types.ts` | Employee, Department, WorkOrder, reviews, status machine |
| Org chart | `src/lib/org/directory.ts` | Departments + employees + `reportsTo` as real data (was prompt prose) |
| Department ledger | `src/lib/org/ledger.ts` | Per-department policies + escalations; finance maps to the legacy accounting KV keys |
| Work orders | `src/lib/org/work-orders.ts` | KV store + enforced status transitions |
| Department engine | `src/lib/org/engine.ts` | worker draft → boss review → approve / bounded revise (max 3 rounds) / escalate |
| Prompt profiles | `src/lib/org/employee-configs.ts` | Per-employee prompts (Phase 2 fills marketing in); default synthesized from the charter |
| API | `src/app/api/org/*` | directory, work-orders (+run/ship/send_back/reject), escalations |

### The work-order lifecycle

```
            queued
              │ run
              ▼
        in_progress ◄────────────┐
              │ draft            │ (boss feedback or
              ▼                  │  owner send-back)
   ┌─── in_review ── revise ──► revision
   │          │
approve   escalate
   │          │
   ▼          ▼
approved   escalated ──► owner answers → answer becomes DEPARTMENT POLICY
   │
   │  ship  ◄── THE OWNER'S APPROVE TRIGGER (Chris)
   ▼
shipped        (send_back → revision · reject → rejected)
```

- Positions with `reportsTo: null` (Stockton, Dana, Vince, and the bosses
  themselves) skip the boss step — their drafts go straight to the owner's
  queue.
- Boss reviews run on `CLAUDE_MANAGER_MODEL` (falls back to `CLAUDE_MODEL`),
  so bosses can use a stronger model than workers.
- Every completed run also lands in the dashboard run logs and posts a signal
  to the cross-agent bus.

### API sketch

```
GET  /api/org/directory                      → org chart
GET  /api/org/work-orders?queue=owner        → Chris's approve queue
POST /api/org/work-orders                    → { assigneeId, title, brief, run: true }
POST /api/org/work-orders/:id                → { action: "ship" | "send_back" | "reject" | "run", notes? }
GET  /api/org/escalations                    → open questions across all departments
POST /api/org/escalations                    → { departmentId, escalationId, answer } → becomes policy
```

Auth: everything sits behind the Tilt OS middleware like the rest of HQ.

## The org chart (Phase 1)

- **Finance & Accounting** — Sterling Vance (CFO, boss) ← Penny Quill.
  Existing bespoke loop untouched; shares its ledger with the Org OS.
- **Marketing** — Harper Slate (Marketing Director, boss) ← Cutter Reel
  (video), Indy Post (posts & images), Sage Rank (SEO + AI search), Piper
  Queue (publisher), Remy Vector (creative director), Sloane Signal (social
  intel). *Positions are in the org chart now; Harper/Cutter/Indy/Sage/Piper
  are `staffed: false` until Phase 2 gives them real prompts wired to the
  Social Studio.*
- **Operations** — Stockton Ledger (reports to leadership).
- **Product & R&D** — Maya Blueprint (boss) ← Dr. Rex Polymer.
- **Business Intelligence** — Dana Metrics, Vince Recon (report to leadership).

## Phase plan

1. **Foundation** (this phase) — org model, department engine, per-department
   ledgers, work orders, API.
2. **Marketing v1** — staff Harper + the four hires with real prompt profiles
   wired to the Social Studio (plan skeleton, asset library, brand KB, GA4);
   the boss dispatches the weekly calendar as work orders; boss review moves
   posts `needs_review → approved`; review-queue UI for Chris (approve
   trigger, send-back, escalation answers); scheduled dispatch via the cron.
3. **Publisher** — real posting to Instagram, TikTok, and Facebook (Meta
   Graph API + TikTok Content Posting API), `scheduled` status, best-time
   posting.
4. **Roll-out** — the same engine for Operations and Product/R&D, org-chart
   UI with reporting lines, department pages, graduation (boss ships without
   the owner trigger once trust is earned).

## Migration notes

- The legacy generic runner (`agent-registry.ts` → `orchestrator.ts` →
  `manager.ts` summarizer) still powers the dashboard "Run All" button and is
  untouched, but new work should go through work orders. It gets retired as
  departments migrate.
- Finance migrates onto the engine last — it works today and its bespoke
  context building (Zoho snapshots, MCP) becomes an employee prompt profile +
  tool hookups once the engine grows tool use.
