// ---------------------------------------------------------------------------
// agent-jobs.ts — what you'd actually come to an agent to do.
//
// An agent page used to open on a connection-test panel, then chat, then a
// stale tool list, then nine runnable reports. That is the system's own view
// of itself: plumbing first, capabilities as a flat list, no clue which of
// them you want. Someone new could not tell what the agent was FOR.
//
// So each agent gets a short list of jobs, written as the thing you turned up
// to do — "New stock arrived", not "Intake". Ordered by how often it happens,
// capped at six, because a list of everything is what we already had.
//
// Not every tool is a job. Reconnecting Zoho is a tool; it is not why anyone
// visits Stockton. Jobs are the front door, the full tool list is still there
// underneath.
// ---------------------------------------------------------------------------

export interface AgentJob {
  /** The job in the owner's words, phrased as the reason you came. */
  label: string;
  /** What happens when you click, in one line. */
  detail: string;
  href: string;
  /** Rough frequency — used only for ordering, most-often first. */
  emphasis?: "primary";
}

export const AGENT_JOBS: Record<string, AgentJob[]> = {
  /* Stockton Ledger — Director of Inventory Operations */
  inventory: [
    {
      label: "See what's in stock",
      detail: "Every stick on hand, by level, size and curve",
      href: "/inventory",
      emphasis: "primary",
    },
    {
      label: "New stock arrived",
      detail: "Upload the count sheet — Stockton reads it and adds the sticks",
      href: "/inventory/intake",
      emphasis: "primary",
    },
    {
      label: "Sell a stick",
      detail: "Scan a serial and mark it sold",
      href: "/inventory/scan",
      emphasis: "primary",
    },
    {
      label: "What's coming from the factory",
      detail: "Sticks in production and when they're due",
      href: "/inventory/production",
    },
    {
      label: "Plan the next order",
      detail: "What to reorder, from live stock and demand",
      href: "/inventory/order-builder",
    },
    {
      label: "Fix the catalog",
      detail: "Retire dead SKUs and clear stock that doesn't exist",
      href: "/inventory/cleanup",
    },
  ],

  /* Penny Quill — Staff Accountant.
     Her thirteen task prompts are real accounting work, not dead weight — the
     problem was a flat list with no signal which of them you need weekly. */
  accounting: [
    {
      label: "Bills to deal with",
      detail: "Everything waiting to be filed or approved",
      href: "/accounting/ap",
      emphasis: "primary",
    },
    {
      label: "Answer her questions",
      detail: "Categorisations she couldn't call herself",
      href: "/questions",
      emphasis: "primary",
    },
    {
      label: "Check the Stripe payouts",
      detail: "Payments matched against the books",
      href: "/accounting/stripe",
      emphasis: "primary",
    },
    {
      label: "Run a finance report",
      detail: "Cash outlook, monthly close, A/R collections, bank rec",
      href: "/dashboard/accounting",
    },
  ],

  /* Sterling Vance — CFO */
  "accounting-manager": [
    {
      label: "Where the money's going",
      detail: "Projections, expected contracts and his analysis",
      href: "/strategy",
      emphasis: "primary",
    },
    {
      label: "Decisions he's raised",
      detail: "Finance calls waiting on you",
      href: "/review",
    },
  ],

  /* June Sable — Financial Analyst */
  "cash-flow-analyst": [
    {
      label: "Cash outlook",
      detail: "The rolling four-week view",
      href: "/strategy",
      emphasis: "primary",
    },
  ],

  /* Piers Vale — Supply Chain & Production */
  "supply-coordinator": [
    {
      label: "Track a shipment",
      detail: "Tracking numbers and timelines from the factory",
      href: "/shipments",
      emphasis: "primary",
    },
    {
      label: "What's in production",
      detail: "Sticks being built and when they're due",
      href: "/inventory/production",
      emphasis: "primary",
    },
  ],

  /* Remy Vector — Creative Director */
  "tilt-design": [
    {
      label: "Make an announcement",
      detail: "Partner and ambassador graphics",
      href: "/studio/announcements",
      emphasis: "primary",
    },
    {
      label: "Team blanket render",
      detail: "Fundraiser blankets in team colours",
      href: "/studio/blanket",
      emphasis: "primary",
    },
    {
      label: "Product catalogue",
      detail: "Catalogue imagery and assets",
      href: "/studio/catalog",
    },
    {
      label: "Design socks",
      detail: "Sock and accessory renders",
      href: "/studio/sox",
    },
  ],

  /* Cutter Reel — Video */
  "video-creator": [
    {
      label: "Build a promo video",
      detail: "Branded motion graphics from real footage",
      href: "/studio/promo",
      emphasis: "primary",
    },
  ],

  /* Piper Queue — Social Publisher */
  "social-publisher": [
    {
      label: "Publish what's approved",
      detail: "Send the approved queue to Instagram, TikTok and Facebook",
      href: "/publish",
      emphasis: "primary",
    },
    {
      label: "Connect an account",
      detail: "Set up or re-link a social account",
      href: "/studio/social/setup",
    },
  ],

  /* Indy Post — Content & Image */
  "content-creator": [
    {
      label: "This week's posts",
      detail: "The plan and the post library",
      href: "/studio/social",
      emphasis: "primary",
    },
    {
      label: "Where the gaps are",
      detail: "What the calendar is missing",
      href: "/studio/social/gaps",
    },
  ],

  /* Dana Metrics — Analytics */
  "website-analytics": [
    {
      label: "How the site's doing",
      detail: "Traffic, conversion and her read on it",
      href: "/dashboard/website-analytics",
      emphasis: "primary",
    },
  ],

  /* Sloane Signal — Social Intelligence */
  "competitor-social": [
    {
      label: "What competitors are posting",
      detail: "Her latest read on rival social activity",
      href: "/dashboard/competitor-social",
      emphasis: "primary",
    },
  ],

  /* Vince Recon — Competitive Intelligence */
  "competitor-intel": [
    {
      label: "Competitor moves",
      detail: "Pricing, products and positioning changes",
      href: "/dashboard/competitor-intel",
      emphasis: "primary",
    },
  ],

  /* Maya Blueprint — Product Design */
  "product-design": [
    {
      label: "Design work in flight",
      detail: "What she's drafting and what's been delivered",
      href: "/dashboard/product-design",
      emphasis: "primary",
    },
  ],

  /* Dr. Rex Polymer — Materials R&D */
  "materials-rd": [
    {
      label: "Materials research",
      detail: "Her findings on carbon layups and construction",
      href: "/dashboard/materials-rd",
      emphasis: "primary",
    },
  ],

  /* Nova Vale — Web Manager */
  "web-manager": [
    {
      label: "Approve a website change",
      detail: "Changes she's drafted, waiting on your go-ahead",
      href: "/review",
      emphasis: "primary",
    },
    {
      label: "Open the store admin",
      detail: "Orders, customers and the custom-build queue",
      href: "/api/modules/launch?m=webadmin",
    },
  ],

  /* Harper Slate — Marketing Director */
  "marketing-director": [
    {
      label: "This week's content",
      detail: "The plan, the post library and what's still a gap",
      href: "/studio/social",
      emphasis: "primary",
    },
    {
      label: "Publish approved posts",
      detail: "Send the approved queue to Instagram, TikTok and Facebook",
      href: "/publish",
      emphasis: "primary",
    },
    {
      label: "Make an announcement graphic",
      detail: "Partner and ambassador art",
      href: "/studio/announcements",
    },
  ],

  /* Reese Calder — Chief of Staff */
  "chief-of-staff": [
    {
      label: "Where does work stand",
      detail: "Every job in flight and who's holding it",
      href: "/work",
      emphasis: "primary",
    },
    {
      label: "Decisions waiting on you",
      detail: "Everything blocked until you weigh in",
      href: "/review",
      emphasis: "primary",
    },
  ],
};

export function jobsFor(employeeId: string): AgentJob[] {
  return AGENT_JOBS[employeeId] ?? [];
}
