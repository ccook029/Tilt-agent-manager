# Org OS — Handoff & Decisions Needed

Chris — the redesign is built through Phase 3 on branch
`claude/laughing-mccarthy-kko3ha`. This is what's done, what I need from you to
switch it fully on, and the calls that are yours to make. Nothing here posts,
spends, or changes a live system until you say so — the whole thing is
propose-only and env-gated by default.

## What's built and working now

- **The org is real.** Departments, employees, and reporting lines are data
  the system enforces (`/org` shows the chart). Finance (Sterling ← Penny) is
  untouched and still works.
- **The department engine.** Any employee drafts → their boss reviews
  (approve / send back with feedback, up to 2 redos / escalate) → approved
  work waits for **your** approve trigger. You never lost the final say.
- **Marketing is staffed.** Harper Slate (Director) + Cutter (video), Indy
  (posts/images), Sage (SEO + AI-search), Piper (publisher), plus Remy and
  Sloane. Harper plans the week and dispatches work orders; every piece is
  reviewed against the brand bar before it reaches you.
- **Your consoles.** `/review` (approve/send-back/reject + answer questions,
  across every department), `/publish` (connection status + one-tap posting of
  approved content), `/org` (the chart). All in the top nav (owner-only).
- **The publisher.** Instagram, TikTok, and Facebook adapters are built and
  wired; they just need credentials.

## What I need FROM YOU to turn it fully on

### 1. Google Search Console (for Sage, the SEO employee)
Check whether tilthockey.com is verified: go to **search.google.com/search-console**,
sign in with the business Google account, and look at the property dropdown
top-left. Tell me:
- Is `tilthockey.com` listed? (If yes — is it under the account tied to your
  GA4, or a different login?)
- If not listed, do you want me to walk you through the one-time DNS or
  GA-tag verification?

Sage works from GA4 today; Search Console gives her real search-query data,
which makes the SEO briefs much sharper.

### 2. Platform credentials for going live (Instagram / TikTok / Facebook)
The publisher is a safe no-op until these are set in Vercel. To post for real:

- **Instagram + Facebook (Meta):** you'll need a Meta Business app with a
  long-lived Page access token (scopes: `instagram_content_publish`,
  `pages_manage_posts`, `pages_read_engagement`), your IG Business account id,
  and your Facebook Page id → `META_ACCESS_TOKEN`, `META_IG_USER_ID`,
  `META_FB_PAGE_ID`. The IG account must be a Business/Creator account linked
  to the Page.
- **TikTok:** a developer app approved for **Direct Post**, a user token with
  `video.publish`, and the media domain verified → `TIKTOK_ACCESS_TOKEN`.
  Note TikTok only accepts **video**.

**Question:** do you already have a Meta Business app and TikTok developer
account, or do you want me to write a step-by-step setup guide for each? These
approvals (especially TikTok Direct Post) can take days, so worth starting
early.

### 3. Turn on the Marketing weekly cadence?
Set `MARKETING_CRON=true` in Vercel to have Harper dispatch the week every
Monday automatically. Until then, run it on demand from `/api/marketing/run`
(or I can add a button). **Do you want it automatic, or on-demand while you get
comfortable?**

## Decisions that are yours (my recommendation in each)

1. **Model tiers.** Workers run on `CLAUDE_MODEL`; bosses can run a stronger
   model via `CLAUDE_MANAGER_MODEL`. Your default `CLAUDE_MODEL` is still
   `claude-sonnet-4-6`. *Recommendation: point workers at Sonnet and set
   `CLAUDE_MANAGER_MODEL` to a top model so reviews are sharp. Want me to bump
   the default `CLAUDE_MODEL` to a current model across the board?*
2. **Publishing gate.** Right now: nothing publishes without you tapping it,
   even after Harper approves. *Recommendation: keep it this way for the first
   month, then "graduate" Harper to auto-publish low-risk pillars once you
   trust the output. The graduation tracking already exists.* **Confirm you
   want the manual gate to start.**
3. **How many pieces per week?** Harper is capped at 4 dispatched pieces per
   run by default (cost/time guard), against a brand cadence of IG 5 / TikTok
   4 / FB 3. *Recommendation: start at 4, raise once you see quality.* **What
   weekly volume do you actually want?**
4. **The two-approval seam (Phase 4).** Today a marketing work order is text;
   the publisher posts rendered Studio posts. They aren't yet the same object,
   so approving in `/review` doesn't auto-create a publishable post. *This is
   the top Phase 4 item — connecting work orders to the render pipeline so
   "ship" produces a ready-to-post piece.* **Confirm that's the priority next.**

## Suggested next steps (Phase 4), in priority order

1. Connect approved marketing work orders → Studio `posts` (copy + render
   brief → render → media), so ship→publish is one flow.
2. Roll the engine to Operations (Stockton) and Product/R&D (Maya ← Rex).
3. Add best-time scheduling + the `scheduled` post status.
4. Graduate Harper to auto-publish selected pillars once trust is earned.
5. Migrate Finance onto the engine (last, since it works today).

Reply on the numbered items and I'll fix/adjust and keep building.
