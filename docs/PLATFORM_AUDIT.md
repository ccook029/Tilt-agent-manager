# Tilt Agent Manager — Platform Audit

**Date:** 2026-07-02 · **Scope:** full codebase, agent roster, UI, integrations
**Verdict:** The platform genuinely works — 8 agents, live Zoho read/write, learning memory, chat command consoles. But it grew by accretion: there are two parallel agent architectures, three ways to call Claude, duplicated Zoho clients, no authentication, and agents that don't share what they know. This audit lists what to fix, in priority order, and sketches the path to a single "Tilt OS."

---

## Scorecard

| Area | Grade | One-line assessment |
|---|---|---|
| Security | 🔴 **F** | No auth on anything — dashboard, financial data, write-capable APIs are public |
| Architecture | 🟡 C+ | Works, but two agent systems + three Claude callers + duplicated Zoho code |
| Agent effectiveness | 🟡 B− | Each agent is good alone; they barely share knowledge or coordinate |
| UI/UX | 🟢 B+ | Strong visual identity; attention is scattered across pages; no global inbox |
| Reliability/ops | 🟡 C+ | No tests, broken lint script, hardcoded model IDs (caused a full outage), quiet cron failures |
| Business coverage | 🟡 B− | Finance/inventory/intel covered; no cash-flow view, no collections follow-through, no single daily brief |

---

## P0 — Do these first

### 1. Authentication (the big one)
There is no auth anywhere. Anyone who finds the URL can: read the books snapshot, run agents (spending API credits), **write categorizations to Zoho Books**, read/answer the CFO question queue, upload/delete documents, and clear chat history. `CRON_SECRET` only guards cron GETs.
**Fix options (in order of effort):**
- **Vercel Deployment Protection** (Settings → Deployment Protection → Password/Vercel Auth) — zero code, protects everything today. *Do this immediately.*
- Proper app auth later: a `middleware.ts` gate (shared passcode cookie or Vercel/Auth.js) covering `/dashboard` and `/api/*` except cron.

### 2. Rotate exposed secrets
The Zoho refresh token appeared in a screenshot during setup. It is the master key to Books+Inventory+Sheet+Mail-adjacent scopes. Regenerate once via the API console (same 3-scope string) and update `ZOHO_REFRESH_TOKEN`. Rotate the Zoho Mail app password if it was ever pasted anywhere.

### 3. Centralize model IDs
`claude-sonnet-4-6` is hardcoded in ~14 files. A model retirement already took the whole platform down once. Create `src/lib/models.ts` (or a `CLAUDE_MODEL` env var) and import everywhere — next migration is a one-line change.

### 4. Billing resilience
The platform silently dies when API credits run out (it just did). Enable console auto-reload; additionally, the daily cron should email a distinctive "AGENTS DOWN — billing" alert when it sees `credit balance` errors rather than a generic failure.

---

## P1 — Architecture consolidation

### 5. Two agent systems; one is vestigial
- **System A** (`agent-registry` → `orchestrator` → `agent-runner` → `manager.ts`): only used by `/api/agents/run`. The cron doesn't use it. Accounting configs are force-cast into its `AgentConfig` shape (`as unknown as`) and don't actually fit.
- **System B** (bespoke pipelines + per-agent routes): what actually runs everything.
**Fix:** delete or quarantine System A (registry/orchestrator/agent-runner), keep the registry only as a typed list of agent metadata if needed. One mental model.

### 6. Three Claude callers → one
`anthropic.ts#callClaude`, `agent-runner.ts`, and `manager.ts` each construct clients and defaults. Consolidate on `callClaude` (it already has MCP support). Same for Zoho: `zoho.ts` still contains an unused Books helper that predates `zoho-books.ts`.

### 7. Sterling vs `manager.ts` — two "managers"
`manager.ts` summarizes all-agent runs for the digest email; Sterling is the accounting manager. Recommendation: **one daily "Tilt Morning Brief"** email that merges: all agent outcomes, accounting status + open questions (with the answer spreadsheet), inventory alerts, failures, and spend. Kill the scattered per-agent emails by default (keep opt-in per task). Today Chris can receive 5+ separate agent emails a day; the inbox becomes the product's enemy.

### 8. Run-log hygiene
`agentName` doubles as an identity+label ("Penny Quill (Auto-Categorize — Dry Run)"), which breaks grouping (the chat "freshest report per task" dedupe keys on it). Add a proper `task` field to `AgentRunLog`.

### 9. Ops basics
- `npm run lint` is broken (Next 16 removed `next lint`) — point it at `eslint`.
- Zero tests. Minimum: unit tests for `txnDirection`, control-block/JSON parsing, policy-ledger resolution, questions-sheet ingestion — the money-touching logic.
- Cron failures only email; also surface them on the dashboard (NeedsAttention already exists — feed it cron results).

---

## P1 — Making the agents better for the business

### 10. Org-wide memory (biggest agent win)
The policy ledger is accounting-only. Generalize it: one `org-knowledge` store all agents read ("Jeremy is a co-founder", "Remitly = Pakistan apparel vendors", "we're cash-basis on payables"). Chris teaches the *company* once, not each agent. Same round-trip mechanics (chat answers → rules) already proven in accounting.

### 11. Agents that inform each other
Today the only cross-agent data path is Penny's inventory tie-out reading Stockton's sheet. High-value additions:
- **Stockton → Sterling:** factory reorder recommendations should flow into a cash-outlook line ("$X committed to POs next 30 days").
- **Penny → Stockton:** categorized revenue vs Stockton's sales velocity — mismatch = unrecorded sales.
- **Dana (analytics) → Sterling:** revenue trend vs cash trend in the same brief.
Mechanism: a small shared "signals" store each pipeline writes headline facts into; the morning brief and chats read it.

### 12. Chat for every agent
`AgentChat` is generic now — give Stockton (and eventually all agents) the same chat+memory+dispatch treatment. "Talk to Stockton: why is INT 18K out of stock?" is as valuable as the accounting chats.

### 13. Finance follow-through (Penny/Sterling roadmap)
- **Wave 2 — A/R collections:** match deposits→invoices (clear the $14.7k), then draft chase emails for genuinely unpaid invoices (Sterling approves, Resend sends). Books cleanup that also *collects money*.
- **Wave 3 — transfers/processor payouts** reclassification (biggest P&L distortion).
- **Cash-flow view:** Sterling composes a rolling 4-week cash outlook (bank balance + A/R expected + PO commitments) — the single most CFO-like artifact he can produce, and no agent does it today.
- **Monthly close cadence:** once caught up, flip `ACCOUNTING_PHASE` to "maintenance" and schedule `monthly-close` on the 1st.

### 14. Question queue is the product — treat it that way
Open questions are the single human touchpoint, but they live inside two chat panels. See UI #16.

---

## P2 — UI improvements

15. **Global attention center on `/dashboard`:** one strip combining open CFO questions (count + inline answer), recent failures (exists), and cleanup progress. Chris should land on one page and know: what needs me, what broke, how's the cleanup trending.
16. **Dedicated `/questions` page:** all open questions, inline answers, Excel round-trip, resolved history (what policy each answer created). Linked from the brief email.
17. **Progress metrics that move:** "Uncategorized: 200 → 174 → 150…" sparkline; A/R outstanding; policies learned; actions written. The HQ metrics bar is static persona info today — make it show the cleanup burning down.
18. **Render agent chat/markdown properly:** chats render in `<pre>`; Penny/Sterling emit tables and headers that show as raw text. Reuse `ReportRenderer` in chat bubbles.
19. **Action log UI:** `/api/accounting/actions` is JSON; add a small "Ledger of changes" panel on Penny's page with an undo button per row (calls `uncategorizeTxn`).
20. **Mobile pass:** the chat + dashboard grid degrade on phones; Chris answers questions from a phone more often than a desk.
21. **Command palette deepening:** ⌘K already exists — add "ask an agent" and "run task" verbs, not just navigation.

---

## The "Tilt OS" vision

Current estate: **this app** (8 agents + HQ), **tilt-catalog-agent** (separate Vercel app, launched via signed link), **tiltinventory.vercel.app** (separate app, plain link), plus Zoho (Books/Inventory/Sheet/Mail), GA4, Resend, Apify.

**Recommended shape — one platform, module architecture:**
- **Phase 1 (consolidate the core):** P0s + single Morning Brief + global questions/attention center. The OS *feel* comes from one inbox and one home page, not from moving code.
- **Phase 2 (shared services):** org-wide memory, signals store, `AgentChat` for all, action audit for anything that writes. These are the OS primitives.
- **Phase 3 (absorb the satellites):** bring tilt-catalog-agent and tiltinventory into this repo as routes/modules (they're already Next-on-Vercel), sharing auth, KV, personas, and the brief. Until then, embed via authenticated links (already done for catalog).
- **Phase 4 (one front door):** the dashboard becomes the OS desktop: modules (Finance / Inventory / Design / Intel), one global chat switcher, one question queue, one daily brief. Agents become features of the OS rather than pages.

---

## Recommended sequencing

| # | Action | Effort | Type |
|---|---|---|---|
| 1 | Vercel Deployment Protection ON | 5 min (Chris) | P0 |
| 2 | API auto-reload + billing alert | 10 min (Chris) + small code | P0 |
| 3 | Rotate Zoho refresh token | 10 min (Chris) | P0 |
| 4 | Centralize model IDs | small | P0 |
| 5 | Morning Brief (one email) + kill per-task email default | medium | P1 |
| 6 | Global attention center + `/questions` page + progress metrics | medium | P1/P2 |
| 7 | Delete vestigial agent system; one Claude caller; log `task` field | medium | P1 |
| 8 | Org-wide memory + signals store | medium | P1 |
| 9 | Chat markdown rendering + action-log UI with undo | small-medium | P2 |
| 10 | A/R collections wave + cash-flow outlook | medium | P1 (business) |
| 11 | Lint fix + money-logic tests | small | P1 |
| 12 | Absorb satellite apps (catalog, inventory) | large | Phase 3 |
