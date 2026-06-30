// ---------------------------------------------------------------------------
// Competitor Social Intelligence Agent — Configuration
//
// Weekly agent that scrapes competitor social media accounts across Instagram
// and TikTok using the Apify API, analyzes content strategy using Claude,
// and delivers a structured report with actionable recommendations.
//
// Schedule: Every Monday at 6 AM ET (10:00 UTC).
// ---------------------------------------------------------------------------

export interface CompetitorSocialAgentConfig {
  id: string;
  name: string;
  schedule: string;
  model: string;
  maxTokens: number;
  temperature: number;

  systemPrompt: string;
  userPrompt: string;

  competitors: CompetitorSocialHandle[];

  email: {
    to: string[];
    from: string;
    subjectTemplate: string;
  };

  enabled: boolean;
}

export interface CompetitorSocialHandle {
  brand: string;
  instagram: string;
  tiktok: string;
}

// -------------------------------------------------------
// Competitor handles — easy to update
// -------------------------------------------------------
const COMPETITOR_HANDLES: CompetitorSocialHandle[] = [
  // Major brands
  {
    brand: "Bauer Hockey",
    instagram: "bauerhockey",
    tiktok: "@bauerhockey",
  },
  {
    brand: "CCM Hockey",
    instagram: "ccmhockey",
    tiktok: "@ccmhockey",
  },
  {
    brand: "True Hockey",
    instagram: "truehockey",
    tiktok: "@truehockey",
  },
  {
    brand: "Warrior Hockey",
    instagram: "warriorhockey",
    tiktok: "@warriorhockey",
  },
  // Smaller / emerging brands
  {
    brand: "Swift Hockey",
    instagram: "swifthockey",
    tiktok: "@swifthockey",
  },
  {
    brand: "CHS Hockey",
    instagram: "chshockey",
    tiktok: "@chshockey",
  },
];

const config: CompetitorSocialAgentConfig = {
  id: "competitor-social",
  name: "Competitor Social Intelligence Agent",
  schedule: "0 10 * * 1", // Monday at 10:00 UTC (6 AM ET)
  model: "claude-sonnet-5",
  maxTokens: 8192,
  temperature: 0.4,

  systemPrompt: `You are a competitive social media strategist for Tilt Hockey, an aggressive and innovative hockey equipment brand. You have been given structured social media data from Tilt Hockey's main competitors for the past 7 days.

Analyze this data and produce a weekly intelligence report covering:
- Which content formats are generating the most engagement
- What messaging themes and hooks are resonating
- Posting frequency and timing patterns
- Any campaigns or product launches detected
- 3-5 specific actionable recommendations Tilt Hockey should act on this week

Be direct and specific. No fluff.

COMPETITOR TIERS:
- Major brands: Bauer, CCM, True, Warrior — benchmark for volume and production quality
- Emerging brands: Swift Hockey, CHS Hockey, and others — watch closely as direct competitors in Tilt's weight class. Their wins and mistakes are more relevant to Tilt's strategy than the majors.

ADDITIONAL GUIDELINES:
- Rank competitors by overall social performance this week
- Separate analysis for major vs. emerging brands where patterns differ
- Call out standout posts with specific engagement numbers
- Identify content gaps Tilt could exploit
- Note any influencer partnerships or athlete endorsements spotted
- Compare engagement rates (likes + comments / estimated followers) where possible
- Flag any product launches, sponsorship announcements, or campaign themes
- Include a "Steal This Idea" section — 2-3 specific content concepts Tilt should create, inspired by what's working for competitors (never copy, always improve)

OUTPUT FORMAT:
1. Executive Summary (3-5 bullets — what Chris needs to know)
2. Platform-by-Platform Breakdown (Instagram, then TikTok)
3. Competitor Rankings Table (Brand | Posts | Avg Engagement | Top Post | Notable)
4. Content Format Analysis (video vs. image vs. carousel performance)
5. Campaign & Launch Detection
6. "Steal This Idea" — 2-3 actionable content concepts for Tilt
7. Recommendations (3-5 specific, prioritized actions for this week)
8. Raw Data Appendix (post-level metrics table)`,

  userPrompt: `Here is the competitor social media data scraped from Instagram and TikTok for the past 7 days (ending {{scan_date}}):

{{social_data}}

{{#if context}}Additional focus from the team: {{context}}{{/if}}

Produce the Weekly Competitor Social Intelligence Report.`,

  competitors: COMPETITOR_HANDLES,

  email: {
    to: ["chris@tilthockey.com"],
    from: "Tilt Agents <agents@tilthockey.com>",
    subjectTemplate: "Weekly Competitor Social Intel — {{scan_date}}",
  },

  enabled: true,
};

export default config;
