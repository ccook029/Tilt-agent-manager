# Org OS — Handoff & Current State

Chris — the redesign is built through Phase 4 on branch
`claude/laughing-mccarthy-kko3ha`. Your earlier decisions are locked in:
publisher targets IG + TikTok + Facebook; you keep the approve trigger;
marketing dispatch is **on-demand** (the "Run marketing week" button on
/review) until the cadence feels normal, then we schedule it every ~3 days;
Harper caps at 4 pieces per dispatch; workers run Claude Sonnet 5 and boss
reviews run Claude Opus 4.8.

## What's built

- **The org** — departments, employees, reporting lines (`/org`), with the
  worker → boss review → your-approve-trigger engine behind every work order.
- **Marketing staffed** — Harper (Director) + Cutter (video), Indy
  (posts/images), Sage (SEO + AI-search), Piper (publisher), Remy, Sloane.
- **Your consoles** — `/review` (approve & ship / send back / reject +
  answer escalations + Run marketing week), `/publish` (platform status,
  approved queue, one-tap posting), `/org` (the chart).
- **Ship → publish is one pipeline** — approving a content work order in
  /review creates approved Studio posts; once media is rendered they appear
  in /publish for posting.
- **Publisher adapters** for Instagram, Facebook (Meta Graph) and TikTok
  (Content Posting API) — live as soon as credentials are added.
- **Search Console integration** — code is ready; needs the 2-step hookup
  below.
- **Every answer you give becomes standing policy** per department, so
  questions are never asked twice.

## Your to-do list (all in docs/PUBLISHER_SETUP.md, step by step)

1. **Search Console (5 min):** add the GA4 service account email as a user in
   Search Console, and set `GSC_SITE_URL` in Vercel. → Sage gets real Google
   query data.
2. **Meta (30-60 min):** follow Part 1 of PUBLISHER_SETUP.md → three env vars
   → Instagram + Facebook go live on /publish.
3. **TikTok (start now, approval takes days-weeks):** follow Part 2 —
   create the developer app and submit for Direct Post review early.
4. **Vercel env check:** if `CLAUDE_MODEL` is pinned in Vercel it overrides
   the new Sonnet 5 default — clear it (or set it to `claude-sonnet-5`).
   Optionally set `CLAUDE_MANAGER_MODEL=claude-opus-4-8` explicitly (that's
   already the code default).

## How to use it day-to-day

1. Open **/review** → tap **Run marketing week**. Harper plans, the team
   drafts, she reviews; a few minutes later approved pieces are waiting.
2. For each piece: **Approve & ship** (content pieces become approved Studio
   posts), **Send back** with a note (the creator redoes it), or **Reject**.
3. Answer anything under "Needs your decision" — each answer becomes
   department policy.
4. Render media for shipped posts in the Studio, then post from **/publish**.
5. When you're comfortable: say the word and I'll wire the every-3-days
   schedule (`MARKETING_CRON` infrastructure is already in the cron).

## Next (Phase 5 candidates, in priority order)

1. Auto-render on ship (post package → render pipeline without the manual
   Studio step).
2. The every-3-days marketing schedule once you're comfortable.
3. TikTok OAuth callback + automatic token refresh.
4. Graduation: let Harper ship low-risk pillars without your tap (ledger
   already tracks readiness).
5. Best-time scheduling + the `scheduled` post status.
6. Migrate Finance onto the engine (last — it works today).
