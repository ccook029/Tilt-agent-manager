// ---------------------------------------------------------------------------
// Website Analytics Agent — Configuration
//
// This agent pulls GA4 data weekly, sends it to Claude for analysis,
// and emails the report to the Tilt Sports team.
// ---------------------------------------------------------------------------

export interface AnalyticsAgentConfig {
  id: string;
  name: string;
  schedule: string;
  model: string;
  maxTokens: number;
  temperature: number;

  systemPrompt: string;
  userPrompt: string; // contains {{variables}} replaced at runtime

  email: {
    to: string[];
    from: string;
    subjectTemplate: string; // supports {{period_end}}
  };

  ga4: {
    metrics: string[];
    dimensions: string[];
  };

  enabled: boolean;
}

const config: AnalyticsAgentConfig = {
  id: "website-analytics",
  name: "Website Analytics Agent",
  schedule: "0 12 * * 1", // Every Monday at 12:00 UTC (8 AM ET)
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
  temperature: 0.4,

  systemPrompt: `You are a senior digital analytics consultant for Tilt Sports Inc., a company that sells air hockey tables, accessories, and runs competitive events.

Your job is to analyze weekly Google Analytics data and produce an actionable report. You understand:
- E-commerce metrics and conversion funnels
- Traffic acquisition channels and attribution
- User engagement patterns
- Seasonal trends in sporting goods

Guidelines:
- Start with a 3-5 bullet executive summary of the most important changes.
- Use tables (plain text, aligned) for data comparisons.
- Calculate week-over-week percentage changes and flag anything that moved more than 15%.
- If any metric declined more than 20%, mark it with 🚨 and explain likely causes.
- End with 2-3 specific, prioritized action items.
- Be direct. No filler. Write for a founder who reads this in 2 minutes.`,

  userPrompt: `Here is the Google Analytics data for Tilt Sports (tiltsports.com) for the week ending {{period_end}}.

**This Week ({{current_period_start}} – {{current_period_end}}):**
{{ga_data_current}}

**Prior Week ({{prior_period_start}} – {{prior_period_end}}):**
{{ga_data_prior}}

{{#if context}}
Additional context from the team: {{context}}
{{/if}}

Please analyze this data and produce the weekly analytics report.`,

  email: {
    to: ["admin@tiltsports.com"],
    from: "Tilt Agents <agents@tiltsports.com>",
    subjectTemplate:
      "Weekly Analytics Report — Week Ending {{period_end}}",
  },

  ga4: {
    metrics: [
      "sessions",
      "totalUsers",
      "newUsers",
      "engagementRate",
      "averageSessionDuration",
      "screenPageViews",
      "conversions",
      "purchaseRevenue",
    ],
    dimensions: [
      "sessionSource",
      "sessionMedium",
      "pagePath",
      "deviceCategory",
      "country",
      "region",
    ],
  },

  enabled: true,
};

export default config;
