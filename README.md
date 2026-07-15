# Tilt Agent Orchestrator

AI agent management system for Tilt Sports Inc. Built with Next.js, deployed on Vercel.

## Architecture

```
Pull data → Build prompt → Call Claude → Email report
```

Agents are defined as config files in `src/agents/`. The orchestrator reads the config, injects real data into prompt templates, calls the Anthropic API, and delivers the output via email.

## Org OS — employees, bosses, and the owner's approve trigger

The platform is evolving from a flat list of agents into a real company
structure: departments of specialist **employees** whose work flows through a
**boss review** before it reaches the founders, with the owner keeping the
final approve trigger. See **[docs/ORG_OS.md](docs/ORG_OS.md)** for the org
chart, the work-order lifecycle, and the phase plan. Core code lives in
`src/lib/org/` with HTTP endpoints under `/api/org/*`.

## Website Analytics Agent

Runs **daily Mon–Fri at 8 AM ET** (12:00 UTC). Pulls GA4 data, sends it to Claude for analysis, and emails an actionable report.

| Day | Report covers | Compared against |
|---|---|---|
| Monday | Saturday + Sunday (weekend) | Prior Saturday + Sunday |
| Tuesday–Friday | Previous day | Same weekday, one week ago |

### Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/analytics/daily` | GET | Vercel Cron trigger (requires `CRON_SECRET`) |
| `/api/analytics/daily` | POST | Direct trigger (no auth required) |
| `/api/analytics/run` | POST | Manual trigger with options |

### Manual trigger

```bash
curl -X POST https://your-app.vercel.app/api/analytics/run \
  -H "Content-Type: application/json" \
  -d '{"report_type": "daily", "context": "We ran a promo yesterday"}'
```

## Setup

### 1. Clone and install

```bash
npm install
```

### 2. Set up Google Service Account for GA4

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use an existing one)
3. Enable the **Google Analytics Data API**:
   - Navigate to APIs & Services → Library
   - Search for "Google Analytics Data API"
   - Click Enable
4. Create a Service Account:
   - Navigate to IAM & Admin → Service Accounts
   - Click "Create Service Account"
   - Give it a name like `tilt-analytics-agent`
   - No need to grant project-level roles
   - Click Done
5. Create a key:
   - Click into the service account
   - Go to Keys → Add Key → Create New Key → JSON
   - Download the JSON file
6. Base64-encode the credentials:
   ```bash
   cat service-account.json | base64 | tr -d '\n'
   ```
   Set this as `GOOGLE_APPLICATION_CREDENTIALS_JSON` in your env vars.
7. Grant GA4 access:
   - Go to [Google Analytics](https://analytics.google.com/)
   - Admin → Property → Property Access Management
   - Add the service account email (e.g., `tilt-analytics-agent@your-project.iam.gserviceaccount.com`)
   - Grant **Viewer** role
8. Get your GA4 Property ID:
   - Admin → Property → Property Details
   - Copy the numeric Property ID
   - Set as `GA4_PROPERTY_ID`

### 3. Set up Resend

1. Sign up at [resend.com](https://resend.com)
2. Add and verify your sending domain
3. Create an API key
4. Set `RESEND_API_KEY` in your env vars

### 4. Environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `GA4_PROPERTY_ID` | Yes | GA4 property ID (numeric) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Yes | Base64-encoded service account JSON |
| `RESEND_API_KEY` | Yes | Resend API key |
| `REPORT_EMAIL_TO` | No | Override report recipients (comma-separated) |
| `CRON_SECRET` | Auto | Vercel sets this for cron auth |
| `EMAIL_FROM` | No | Default sender for general orchestrator emails |
| `EMAIL_TO` | No | Default recipient for general orchestrator emails |
| `NEXT_PUBLIC_CATALOG_URL` | No | Base URL of the Catalog Builder tool (public, safe to commit) |
| `CATALOG_ACCESS_KEY` | No | Shared secret for the Catalog Builder tool. **Server-only** — set in Vercel only, must match the `tilt-catalog-agent` project's value |

### 5. Deploy to Vercel

```bash
vercel deploy
```

Set all environment variables in the Vercel dashboard under Settings → Environment Variables.

The cron job is configured in `vercel.json` and will activate automatically after deployment.

## Catalog Builder (external tool)

**Catalog Builder** is registered as an agent but, unlike the others, it isn't a
Claude pipeline — it's a standalone deployed app
([`tilt-catalog-agent`](https://tilt-catalog-agent.vercel.app/)) that turns a
team name, colors, and an uploaded jersey/logo into rendered catalog product
images via Gemini. It appears as a persona on the home page and dashboard and
opens in a new tab.

Its endpoints are gated by a shared secret. The dashboard hands that secret to
the tool via `GET /api/catalog/launch`, which builds the target URL
**server-side** (`${NEXT_PUBLIC_CATALOG_URL}?key=${CATALOG_ACCESS_KEY}`) and
redirects — so the key never ships in the client bundle. The tool reads the key
once, stores it in `sessionStorage`, scrubs it from the visible URL, and sends
it on every request as `X-Catalog-Key`.

Set both `NEXT_PUBLIC_CATALOG_URL` and `CATALOG_ACCESS_KEY` in Vercel (see the
environment-variables table). `CATALOG_ACCESS_KEY` must match the
`tilt-catalog-agent` project's value exactly and must never be committed.

## Adding new agents

1. Copy `src/agents/_template.ts` to `src/agents/your-agent.config.ts`
2. Define the system prompt, user prompt (with `{{variables}}`), schedule, and email settings
3. Create a data pipeline in `src/lib/` if the agent needs external data
4. Create an API route in `src/app/api/` that wires it all together
5. Add a cron entry in `vercel.json`

## Project structure

```
src/
├── agents/
│   ├── _template.ts                          # Agent config template
│   └── website-analytics-agent.config.ts     # Analytics agent config
├── lib/
│   ├── types.ts                              # Core types
│   ├── ga4.ts                                # GA4 data pipeline
│   ├── anthropic.ts                          # Claude API + variable substitution
│   ├── email.ts                              # Resend email (text + HTML)
│   ├── agent-runner.ts                       # Generic agent runner
│   ├── agent-registry.ts                     # Agent registry
│   ├── manager.ts                            # Manager summarisation
│   ├── orchestrator.ts                       # Top-level orchestration
│   └── store.ts                              # Run log persistence
├── app/
│   ├── layout.tsx / page.tsx                 # Landing page
│   ├── dashboard/page.tsx                    # Admin dashboard
│   └── api/
│       ├── analytics/
│       │   ├── daily/route.ts                # Daily report (cron + manual)
│       │   └── run/route.ts                  # Manual trigger with options
│       ├── cron/run-agents/route.ts          # General orchestrator cron
│       └── agents/
│           ├── run/route.ts                  # Manual agent trigger
│           └── logs/route.ts                 # Run history API
```
