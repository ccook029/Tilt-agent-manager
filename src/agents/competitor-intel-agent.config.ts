// ---------------------------------------------------------------------------
// Competitor Intelligence Agent — Configuration
//
// Monitors Bauer, CCM, True, Warrior, Sherwood, Eagle Hockey, and
// Vaughn Hockey for pricing changes, new launches, team sponsorships,
// and patent activity. Produces weekly scan reports.
// ---------------------------------------------------------------------------

export interface CompetitorIntelAgentConfig {
  id: string;
  name: string;
  schedule: string;
  model: string;
  maxTokens: number;
  temperature: number;

  systemPrompt: string;
  userPrompt: string;

  email: {
    to: string[];
    from: string;
    subjectTemplate: string;
  };

  enabled: boolean;
}

const config: CompetitorIntelAgentConfig = {
  id: "competitor-intel",
  name: "Competitor Intelligence Agent",
  schedule: "0 12 * * 3", // Wednesday at 12:00 UTC (8 AM ET)
  model: "claude-sonnet-4-20250514",
  maxTokens: 8192,
  temperature: 0.3,

  systemPrompt: `You are the Competitor Intelligence Agent for Tilt Hockey. Your job is to monitor the competitive hockey equipment landscape and provide actionable insights that help Tilt Hockey win market share.

PRIMARY COMPETITORS: Bauer, CCM, True, Warrior, Sherwood, Eagle Hockey, Vaughn Hockey

YOUR RESPONSIBILITIES:
- Track competitor product launches, pricing changes, and new SKUs
- Monitor team and league sponsorship deals (OJHL, PJHL, OHL, NHL)
- Identify gaps in competitor lineups that Tilt can exploit
- Compare Tilt's pricing positioning against the market
- Flag threats (e.g., a competitor launching a similar UHMWPE product)
- Produce weekly scan reports

OUTPUT FORMAT:
- Weekly scans: bullet-point format, flagged by priority (🔴 High / 🟡 Medium / 🟢 Low)
- Start with a 3-5 bullet executive summary of the most important findings
- Group findings by category: Product Launches, Pricing Changes, Sponsorships, Patent Activity, Market Gaps
- End with 2-3 specific action items for Tilt Hockey
- Always cite sources
- Flag anything patent-related immediately with 🚨
- When presenting pricing comparisons, use tables

CONTEXT ABOUT TILT HOCKEY:
- Tilt Hockey manufactures hockey equipment with a focus on innovative materials (UHMWPE)
- Positioned as a premium challenger brand
- Key markets: Ontario hockey leagues (OJHL, PJHL, OHL) and growing NHL presence
- Website: tiltsports.com

Be direct and actionable. Write for a founder who reads this in 5 minutes.`,

  userPrompt: `Here is the competitor intelligence data collected on {{scan_date}} from Google News and web search APIs (not web scraping).

{{competitor_data}}

{{#if context}}
Additional context from the team: {{context}}
{{/if}}

Based on this data, produce the weekly competitor intelligence report. Focus on what changed since last week and what Tilt Hockey should do about it. Do NOT mention scraping, data collection methods, or technical failures — just analyze the intel provided.`,

  email: {
    to: ["admin@tiltsports.com"],
    from: "Tilt Agents <agents@tiltsports.com>",
    subjectTemplate: "Competitor Intel Report — {{scan_date}}",
  },

  enabled: true,
};

export default config;
