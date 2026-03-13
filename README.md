# Tilt Agent Orchestrator

AI agent management system for Tilt Sports Inc. Built with Next.js, deployed on Vercel.

## Architecture

```
Pull data → Build prompt → Call Claude → Email report
```

Agents are defined as config files in `src/agents/`. The orchestrator reads the config, injects real data into prompt templates, calls the Anthropic API, and delivers the output via email.

## Website Analytics Agent

Runs every Monday at 12:00 UTC (8 AM ET). Pulls the prior week's GA4 data, sends it to Claude for analysis, and emails an actionable report.

### Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/analytics/weekly` | GET | Vercel Cron trigger (requires `CRON_SECRET`) |
| `/api/analytics/weekly` | POST | Direct trigger (no auth required) |
| `/api/analytics/run` | POST | Manual trigger with options |

### Manual trigger

```bash
curl -X POST https://your-app.vercel.app/api/analytics/run \
  -H "Content-Type: application/json" \
  -d '{"report_type": "weekly", "context": "We ran a promo this week"}'
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

### 5. Deploy to Vercel

```bash
vercel deploy
```

Set all environment variables in the Vercel dashboard under Settings → Environment Variables.

The cron job is configured in `vercel.json` and will activate automatically after deployment.

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
│       │   ├── weekly/route.ts               # Weekly report (cron + manual)
│       │   └── run/route.ts                  # Manual trigger with options
│       ├── cron/run-agents/route.ts          # General orchestrator cron
│       └── agents/
│           ├── run/route.ts                  # Manual agent trigger
│           └── logs/route.ts                 # Run history API
```
