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

## Phase 5 (built — 2026-07-15)

1. **Auto-render on ship** ✅ — shipping a content piece now matches it to
   the best library asset and renders static images immediately; it lands in
   /publish with media attached. Reels render on the Studio's next video
   pass. If the library lacks the footage, the ship confirmation tells you.
2. **The every-3-days schedule** ✅ (still off) — when you're ready, set
   `MARKETING_CRON=true` in Vercel (and optionally
   `MARKETING_CRON_EVERY_DAYS`, default 3). Weekdays only, and your manual
   button runs reset the clock so it never double-fires.
3. **TikTok is now one-click** ✅ — once TikTok approves the app, you just
   add `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` and tap **Connect TikTok**
   on /publish. Tokens refresh themselves. (PUBLISHER_SETUP.md Part 2
   updated.)

## Phase 6 (built — 2026-07-15): the whole company is on the pipeline

- **Every department is staffed for work orders now** — Stockton (grounded in
  your live Zoho Sheet/Inventory data), Maya (who also reviews Rex's R&D for
  buildability before it reaches you), Rex, Dana, and Vince all have real
  job training, not generic prompts.
- **Any boss can dispatch** — /org now has a **Dispatch team** button per
  department (Maya can plan Product's period the way Harper plans
  marketing's).
- **You can assign work to anyone** — every department card on /org has an
  **"+ Assign work"** form: pick the employee, write what you want in your
  own words, and it runs through their boss's review into /review.
- **Graduation exists (all off)** — each managed department has an
  "Owner gate on / Graduated" toggle on /org. Graduating means boss-approved
  work ships without your tap; escalations still always come to you. Flip it
  per department whenever a boss has earned it.

## Next (Phase 7 candidates)

1. Best-time post scheduling + the `scheduled` status.
2. Migrate Finance onto the engine (last — it works today).
3. New hires as needs emerge (customer service, ambassador manager) — adding
   one is now just a directory entry + a prompt profile.
