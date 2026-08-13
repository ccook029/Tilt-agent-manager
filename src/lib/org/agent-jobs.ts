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

  /* Penny Quill — Accounting */
  accounting: [
    {
      label: "Bills to deal with",
      detail: "Everything waiting to be filed or approved",
      href: "/accounting/ap",
      emphasis: "primary",
    },
    {
      label: "Check the Stripe payouts",
      detail: "Payments matched against the books",
      href: "/accounting/stripe",
      emphasis: "primary",
    },
    {
      label: "Answer her questions",
      detail: "Categorisations she couldn't call herself",
      href: "/questions",
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
