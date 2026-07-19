# HQ Blueprint — stand up an AI-employee hub for a new business

**What this is:** a build guide for cloning the "Tilt OS" pattern — an internal
hub where AI *employees*, grouped into *departments* with *bosses* who review
work before it reaches the owner — for a different business. Written for a
Claude Code session working in a fresh repo. The reference implementation is
`ccook029/tilt-agent-manager` (add it to the session so files can be copied
directly).

**The new business needs:** Accounting · Operations · Lead sourcing.
It does NOT need: marketing/social, the Stick Order Builder, inventory,
design studio, or the tiltweb public-site integrations.

---

## 0. Fill this in first (owner: complete before building)

The whole system keys off a small set of facts. Get these from the owner
(Chris) before writing any prompts:

- **Business name + one-paragraph description** (what it sells, to whom, how
  it makes money).
- **The ethos/philosophy** — 5–10 bullet points on how the company thinks
  (the Tilt version lives in `docs/ETHOS.md` → `src/lib/ethos.ts` and is
  injected into every employee; it's the single highest-leverage file).
- **Accounting stack**: which system? (Tilt uses Zoho Books/Inventory via
  REST + an optional Zoho MCP server. If this business uses QuickBooks/Xero/
  something else, the Finance *department context* needs a new data feed —
  or start with paste-a-report grounding and wire the API later.)
- **Lead sourcing definition**: what is a lead here? (a retailer? a
  contractor? a property? a clinic?) What makes one *qualified*? Where do
  leads come from (web research works day one via Anthropic server-side web
  search — no extra keys)?
- **Operations definition**: what recurring physical/logistical reality does
  the business have? (suppliers? shipments? inventory? bookings?) The
  shipment register (`/shipments`) is generic enough to reuse as-is if
  anything physically moves.

---

## 1. Architecture in one page (what you're porting)

One Next.js App Router app on Vercel. State in Vercel KV (Upstash). No
database required for the org core.

**The org engine loop** (`src/lib/org/engine.ts`):
work order → **worker drafts** → **boss reviews** (approve / send back up to
3 rounds / escalate a question) → **owner console** (`/review`) → approve &
ship. Escalation answers become standing policy. Errored orders surface with
a Retry. This file is business-agnostic — port unchanged.

**Everything about the org is data, not code:**

| Concern | File | Port? |
|---|---|---|
| Departments + employees + reporting lines | `src/lib/org/directory.ts` | rewrite data, keep shapes |
| Per-employee prompts (worker + boss + guidance + `research` flag) | `src/lib/org/employee-configs.ts` | rewrite data, keep shapes |
| Live per-department grounding | `src/lib/org/department-context.ts` | rewrite per integration; **best-effort: a missing integration degrades to a note, never throws** |
| Boss planning → team dispatch | `src/lib/org/dispatch.ts` + `src/lib/client/dispatch.ts` | port; edit `DISPATCH_INSTRUCTIONS` |
| Work-order store (KV) | `src/lib/org/work-orders.ts` | port unchanged |
| Org-wide switches (auto-ship graduation) | `src/lib/org/settings.ts` | port unchanged |
| Company ethos → every prompt | `src/lib/ethos.ts` via `src/lib/org-knowledge.ts` | rewrite content, keep the single choke point |
| Ship executors (what "ship" does per dept) | `src/lib/org/ship-executors.ts` | strip the marketing executor; default = status change (the deliverable IS the product; emails live in ```` ```email ```` blocks) |

**Claude plumbing** — port unchanged:
- `src/lib/anthropic.ts` — `callClaude()`: text, images (vision), remote MCP
  servers, Anthropic server-side web search (`web_search_20260209`), retries,
  `pause_turn` resume. Web search needs no extra keys.
- `src/lib/models.ts` — worker model / manager model env split
  (`CLAUDE_MODEL` = sonnet-tier, `CLAUDE_MANAGER_MODEL` = opus-tier) and
  `samplingParams()` which **strips `temperature` for models matching
  `/opus-4-[78]|sonnet-5|fable|mythos/`** (they 400 on it). Always call
  through it.
- `src/lib/agent-chat.ts` + `src/components/generic-agent-chat.tsx` — chat
  with any employee: persistent transcript (KV), employee prompt + live
  department context, **bosses get their whole team's recent output** and can
  hand out work via ```` ```assign ```` blocks the UI turns into one-click
  "Assign & run" cards. Supports screenshot attachments (client downscales
  to ≤1600px JPEG to stay under Vercel's ~4.5MB body cap).
- TTS stack: `src/app/api/agents/tts/*` + `src/lib/tts-voices.ts` — provider
  ladder ElevenLabs (streamed, turbo model) → Gemini TTS → browser voice;
  per-employee voice picks in KV; picker on the employee page. Optional but
  it's a crowd-pleaser.

**UI to port:** `/org` (chart + assign), `/org/[id]` (employee page: chat,
voice picker, work history, dispatch), `/review` (owner console),
`/dashboard` (ops overview: attention strip, failures, signals, activity),
command palette, `/knowledge` (editable company knowledge), `/questions`
(escalations), signals feed lib. Skip `/studio`, `/inventory`, `/publish`,
`/staff`, `/strategy`, `/shipments` (unless ops moves physical goods — then
keep `/shipments`; it's generic: vendor, tracking #, carrier, ETA,
overdue/due-soon flags feeding the ops department context).

**Cron:** `vercel.json` crons → `/api/cron/run-agents`; per-agent schedules
in `src/agents/*.config.ts` (the legacy scheduled-agent registry,
`src/lib/agent-registry.ts`). For the new business you may not need any
scheduled agents on day one — the org engine is on-demand.

---

## 2. Proposed org for this business (edit freely)

Keep it small; hire more positions later by adding directory entries (staffed
positions are just data — `staffed: false` reserves a seat).

```
Office of the Founders (executive)
└─ Chief of Staff — synthesizes all departments into one briefing (hire LAST,
   after others have activity to summarize)

Finance & Accounting (finance)         boss: Controller
├─ Bookkeeper — categorize, reconcile, flag anomalies (worker)
└─ Financial Analyst — cash outlook, margins, spend review (worker)

Operations (operations)                boss: Ops Manager
└─ Ops Coordinator — vendor/supplier comms, schedules, shipment
   tracking if physical goods move (worker; ```email``` deliverables)

Business Development (bizdev)          boss: BD Director
├─ Lead Researcher — finds real prospects on the live web
   (worker; `research: true` → web search ON)
├─ Lead Qualifier — scores researcher output against the ICP (worker)
└─ Outreach Writer — first-contact emails in the owner's voice (worker)
```

Six workers + three bosses. Every employee gets: an id, a name/persona (pick
fresh names — don't reuse Tilt's), a one-paragraph `charter`, a
`systemPrompt` in employee-configs, and membership in the review loop.
Bosses also get a `managerSystemPrompt` that encodes the quality bar.

**Prompt-writing rule that worked:** the boss prompts are where quality
lives. Write them as a hard checklist of what FAILS a draft (unverifiable
claims, wrong voice, missing specifics), not vibes. Workers get the
DECISION_PROTOCOL (```` ```json ```` decision-request block) so blockers
escalate instead of being guessed at.

---

## 3. Build order (each step ships something testable)

1. **Repo bootstrap**: new Next.js (App Router) + Tailwind, dark theme.
   Copy the lib/org core + anthropic/models/agent-chat + KV setup from the
   reference repo. Get `npx tsc --noEmit` clean.
2. **Ethos + directory + configs**: write `ETHOS.md` with the owner, encode
   it, define the org above in `directory.ts` + `employee-configs.ts` with
   `department-context.ts` returning static notes for now ("no live data
   wired yet — work from the brief").
3. **Engine + review console**: port engine, work-orders, `/review`, `/org`,
   `/org/[id]` with chat. **Test:** assign the Bookkeeper a pasted bank-feed
   snippet → categorized draft lands in `/review` after Controller review.
4. **Web search for BD**: `research: true` on the Lead Researcher; test with
   a real prospect-hunting brief; confirm citations come back.
5. **Dispatch**: boss "Dispatch team" buttons via the two-phase background
   helper (plan run:false, then run each order per-request — this exists to
   dodge Vercel's 300s function cap; don't inline it).
6. **Integrations, one at a time**, each as a `department-context.ts` feed:
   accounting API first (read-only), then whatever ops needs. Best-effort
   always.
7. **Voice + chat polish** (optional): TTS route, voice picker, screenshots.

---

## 4. Environment variables

| Var | Needed | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | powers everything |
| `CLAUDE_MODEL` | yes | worker model (sonnet tier) |
| `CLAUDE_MANAGER_MODEL` | yes | boss model (opus tier) |
| `KV_*` (Vercel KV/Upstash) | yes | auto-added when you attach KV storage |
| `GEMINI_API_KEY` | optional | TTS fallback (+ any image work) |
| `ELEVENLABS_API_KEY` | optional | best voices. **Must be unrestricted or have Voices: Read — a TTS-only scoped key 401s on the voice list** |
| `ELEVENLABS_MODEL` | optional | default `eleven_turbo_v2_5`; `eleven_multilingual_v2` = higher polish, slower |
| accounting-system creds | later | whatever the business uses |

---

## 5. Hard-won gotchas (read before debugging)

- **Squash-merge flow**: `main` is canonical; the work branch carries only
  merged history after each squash, so restart it every time:
  commit → `git rebase --onto origin/main <prev-head> <branch>` (or
  `checkout -B <branch> origin/main` post-merge) → `push --force-with-lease`.
  Never merge the stale base back in.
- **Vercel builds**: add the `ignoreCommand` to `vercel.json` on day one so
  only `main` builds — kills the confusing preview rows:
  `"ignoreCommand": "[ \"$VERCEL_GIT_COMMIT_REF\" != \"main\" ] && exit 0 || exit 1"`.
  Env-var changes only take effect on the NEXT deployment. "Redeploy" on an
  old row rebuilds the OLD commit — use Create Deployment → `main` instead.
  Occasionally a webhook build is silently missed; push a trivial commit.
- **Model params**: never pass `temperature` directly — go through
  `samplingParams()`. Rarely the API 200s with EMPTY text; `agent-chat.ts`
  retries once then fails loudly (keep that).
- **Vision**: images go as base64 content blocks ahead of the text; the
  client must downscale before upload (Vercel body cap). Don't persist
  base64 into the KV transcript — store a `[screenshot attached]` note.
- **Audio UX**: voice is click-to-listen only (no auto-speak); the Listen
  button toggles to Stop for the whole load+play cycle; a generation counter
  abandons superseded in-flight TTS requests (else double-click = overlap);
  stream the ElevenLabs response through a GET endpoint so playback starts
  immediately.
- **`fetch()` strips the Authorization header on cross-origin redirects**
  (apex→www). If the hub ever calls an authed sister site, use the
  manual-redirect `fetchWithKey` pattern (`src/lib/order-builder/data.ts`).
- **Timeouts**: chat route `maxDuration 120`, work-order route 300. Anything
  fanning out multiple engine runs must use the two-phase client helper.
- **KV keys in use** (avoid collisions if sharing a KV store — better: give
  the new business its OWN KV database): `org-settings`, work orders,
  `tts-voice-map`, agent chat transcripts, signals, dispatch cadence.

---

## 6. Session setup for the build

1. Owner creates the new empty repo + a Claude Code session on it.
2. `add_repo ccook029/tilt-agent-manager` into the same session so the
   reference code is readable/copyable.
3. Paste this file (it should live at the new repo root or `docs/`) and the
   filled-in §0 answers.
4. Build in the §3 order; squash-merge PRs into `main`; owner promotes in
   Vercel (separate Vercel project, separate KV store, own env vars).
5. Owner tests employee-by-employee with real briefs (the pattern that
   worked at Tilt: quick no-integration wins first, then web-search roles,
   then data-fed roles, Chief of Staff last).
