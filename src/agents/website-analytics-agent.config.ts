// ---------------------------------------------------------------------------
// Website Analytics Agent — Configuration
//
// This agent pulls GA4 data daily (Mon–Fri), sends it to Claude for
// analysis, and emails the report to the Tilt Hockey team.
//
// Monday reports cover Saturday + Sunday (the weekend).
// Tuesday–Friday reports cover the previous day.
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
    subjectTemplate: string; // supports {{period_end}}, {{period_label}}
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
  schedule: "0 12 * * 1-5", // Mon–Fri at 12:00 UTC (8 AM ET)
  model: "claude-sonnet-4-6",
  maxTokens: 4096,
  temperature: 0.4,

  systemPrompt: `You are a senior digital analytics consultant for Tilt Hockey Inc., a company that sells air hockey tables, accessories, and runs competitive events.

Your job is to analyze Google Analytics data and produce a concise, actionable daily report. You understand:
- E-commerce metrics and conversion funnels
- Traffic acquisition channels and attribution
- User engagement patterns
- Seasonal trends in sporting goods
- Day-of-week and weekend vs weekday behavioral differences

Guidelines:
- Start with a 3-5 bullet executive summary of the most important changes.
- Use tables (plain text, aligned) for data comparisons.
- Calculate percentage changes vs the comparison period and flag anything that moved more than 15%.
- If any metric declined more than 20%, mark it with 🚨 and explain likely causes.
- On Monday reports (weekend data), note any weekend-specific patterns and compare to the prior weekend.
- End with 2-3 specific, prioritized action items.
- Be direct. No filler. Write for a founder who reads this in 2 minutes.`,

  userPrompt: `Here is the Google Analytics data for Tilt Hockey (tilthockey.com).

**Report: {{period_label}}**

**Current Period ({{current_period_start}} – {{current_period_end}}):**
{{ga_data_current}}

**Comparison Period ({{prior_period_start}} – {{prior_period_end}}):**
{{ga_data_prior}}

{{#if context}}
Additional context from the team: {{context}}
{{/if}}

Please analyze this data and produce the {{period_label}} analytics report.`,

  email: {
    to: ["chris@tilthockey.com"],
    from: "Tilt Agents <agents@tilthockey.com>",
    subjectTemplate:
      "{{period_label}} Analytics — {{period_end}}",
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
