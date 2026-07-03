# Sterling — Your Tilt Financial Analyst

The CFO agent (Sterling) is now your personal financial analyst & strategist,
living in the owner-only **Strategy** area (`/strategy`). No new env vars — it
uses the accounting-owner gate you already configure with
`ACCOUNTING_OWNER_EMAILS`, and stores everything in KV.

## The four tabs

- **Analyst** — talk to Sterling about strategy, projections, and reports, and
  one-click generate a **Growth strategy**, **Projection briefing**, or
  **Financial briefing** memo. He reasons with your knowledge + live pipeline.
- **Projections** — forward 12-month revenue from your expected-contracts
  pipeline: **committed** (won only), **probability-weighted**, and **best-case**,
  per month with totals.
- **Contracts** — log expected/pending deals (team orders, sponsorships,
  wholesale, retainers): amount, cadence (one-time / monthly / annual),
  probability, start date, term, status. These drive the projections.
- **Knowledge** — paste your **Tilt Business Strategist** project here (its
  instructions + key docs). Sterling reads this in every conversation, so he
  grounds answers in how Tilt actually operates. Edit anytime; no redeploy.

## How to load your strategist knowledge

1. Open your Tilt Business Strategist Claude project → copy its custom
   instructions and the important knowledge docs.
2. Strategy → **Knowledge** → paste it all in → **Save**.
   That's it — Sterling now reasons with it. (Up to ~60k characters; if you
   have more, keep the highest-signal material — model, unit economics, growth
   theses, historical context.)

## How projections work

Each contract is recognized monthly over its term: one-time deals land in their
start month; monthly deals add their amount each month; annual deals spread as
amount/12. Every line is shown three ways — committed (status = won),
probability-weighted (amount × probability; won = 100%, lost = 0%), and
best-case (all non-lost at 100%). It's a **revenue** view; Sterling calls out
revenue-recognition vs cash-timing differences when they matter.

## Real-time financials

Sterling's live grounding today comes from the Zoho-connected accounting data
and Penny's latest findings (already wired into his chat), plus your pipeline
and projection. To add a live payments feed (e.g. Stripe) later, authorize the
Stripe connector and we can fold it into his context — say the word.
