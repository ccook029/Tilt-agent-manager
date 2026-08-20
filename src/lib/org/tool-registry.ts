// ---------------------------------------------------------------------------
// tool-registry.ts — every workspace in HQ, in one place.
//
// The problem this solves: features were registered in two places that didn't
// know about each other. A department carried a hand-written tool list, and
// /inventory carried its own tab strip. Four inventory tools — Receive Stock,
// Staged Changes, Legacy Cleanup, Apparel Groups — only ever existed in the
// tab strip, so unless you were already on that page there was no route to
// them at all.
//
// So: one list. The agent pages, the global index and the section tab strips
// all read from here, which means a tool that isn't registered is visibly
// missing everywhere rather than quietly missing from one of them.
//
// Adding a page? Add it here in the same commit. That is the whole discipline.
// ---------------------------------------------------------------------------

/** What you'd be trying to do when you go looking for it. */
export type ToolGroup = "daily" | "decide" | "cleanup" | "setup";

export const GROUP_LABELS: Record<ToolGroup, string> = {
  daily: "Day to day",
  decide: "Needs a decision",
  cleanup: "Clean-up & corrections",
  setup: "Setup & connections",
};

/** Group ordering — most-used first, so a page reads top-down by frequency. */
export const GROUP_ORDER: ToolGroup[] = ["daily", "decide", "cleanup", "setup"];

export interface Tool {
  href: string;
  label: string;
  /** One line, in the owner's terms, saying what it's for. */
  description: string;
  group: ToolGroup;
  /** Employee id who runs this. Empty means it belongs to the whole company
   *  (the review queue, the signals feed) rather than one person. */
  ownerId?: string;
  /** Section this belongs to, for the tab strips: "inventory", "studio", … */
  section?: string;
  /** Shown in a section's tab strip, in this order. */
  tabLabel?: string;
  /** Opens outside HQ. */
  external?: boolean;
}

export const TOOLS: Tool[] = [
  /* ── Company-wide ────────────────────────────────────────────────────── */
  {
    href: "/review",
    label: "Review Queue",
    description: "Everything waiting on a founder's decision",
    group: "decide",
  },
  {
    href: "/notes",
    label: "Notes",
    description: "Things to remember — yours and Jeremy's, with follow-up dates",
    group: "daily",
  },
  {
    href: "/work",
    label: "Work Board",
    description: "Where every job currently sits, and who has it",
    group: "daily",
  },
  {
    href: "/questions",
    label: "Open Questions",
    description: "Decisions the agents have escalated to you",
    group: "decide",
  },
  {
    href: "/dashboard",
    label: "Signals Feed",
    description: "Company-wide activity as it happens",
    group: "daily",
  },
  {
    href: "/activity",
    label: "Activity Log",
    description: "Every agent run, with its output",
    group: "daily",
  },
  {
    href: "/org",
    label: "Org Chart",
    description: "Who does what, and who reports to whom",
    group: "daily",
  },
  {
    href: "/knowledge",
    label: "Knowledge",
    description: "What every agent knows about the company",
    group: "setup",
  },
  {
    href: "/files",
    label: "Files",
    description: "Reports and documents the agents have produced",
    group: "daily",
  },
  {
    href: "/staff",
    label: "Staff Tools",
    description: "Day-to-day tools for the team",
    group: "daily",
  },

  /* ── Operations — Stockton ───────────────────────────────────────────── */
  {
    href: "/inventory",
    label: "Stick Inventory",
    description: "Every stick on hand, straight from the Zoho sheet",
    group: "daily",
    ownerId: "inventory",
    section: "inventory",
    tabLabel: "Inventory",
  },
  {
    href: "/inventory/scan",
    label: "Scan & Sell",
    description: "Scan a serial to look up a stick or mark it sold",
    group: "daily",
    ownerId: "inventory",
    section: "inventory",
    tabLabel: "Scan & Sell",
  },
  {
    href: "/inventory/intake",
    label: "Receive Stock",
    description: "Upload a count sheet — Stockton reads it and adds the sticks",
    group: "daily",
    ownerId: "inventory",
    section: "inventory",
    tabLabel: "Receive Stock",
  },
  {
    href: "/inventory/production",
    label: "In Production",
    description: "Sticks being built at the factory, and when they're due",
    group: "daily",
    ownerId: "inventory",
    section: "inventory",
    tabLabel: "In Production",
  },
  {
    href: "/inventory/order-builder",
    label: "Stick Order Builder",
    description: "Build the next factory order from live demand",
    group: "daily",
    ownerId: "inventory",
    section: "inventory",
    tabLabel: "Order Builder",
  },
  {
    href: "/inventory/actions",
    label: "Staged Zoho Changes",
    description: "Catalog changes worked out in advance, waiting on your push",
    group: "cleanup",
    ownerId: "inventory",
    section: "inventory",
    tabLabel: "Staged Changes",
  },
  {
    href: "/inventory/cleanup",
    label: "Legacy SKU Cleanup",
    description: "Retire old items and clear stock that doesn't exist",
    group: "cleanup",
    ownerId: "inventory",
    section: "inventory",
    tabLabel: "Legacy Cleanup",
  },
  {
    href: "/inventory/apparel",
    label: "Apparel Item Groups",
    description: "Build colour × size variants in Zoho",
    group: "setup",
    ownerId: "inventory",
    section: "inventory",
    tabLabel: "Apparel Groups",
  },
  {
    href: "/shipments",
    label: "Shipments",
    description: "Tracking and timelines for factory shipments",
    group: "daily",
    ownerId: "supply-coordinator",
  },
  {
    href: "/zoho/reconnect",
    label: "Reconnect Zoho",
    description: "Rotate the Zoho token when the connection drops",
    group: "setup",
    ownerId: "inventory",
  },

  /* ── Finance — Penny, Sterling, June ─────────────────────────────────── */
  {
    href: "/accounting/ap",
    label: "Accounts Payable",
    description: "Bills waiting to be filed and approved",
    group: "daily",
    ownerId: "accounting",
    section: "accounting",
    tabLabel: "AP",
  },
  {
    href: "/accounting/stuck-orders",
    label: "Stuck Orders",
    description: "Paid orders Zoho never heard about — sync them with one press",
    group: "daily",
    ownerId: "accounting",
    section: "accounting",
    tabLabel: "Stuck Orders",
  },
  {
    href: "/accounting/stripe",
    label: "Stripe Reconciliation",
    description: "Payouts matched against the books",
    group: "daily",
    ownerId: "accounting",
    section: "accounting",
    tabLabel: "Stripe",
  },
  {
    href: "/strategy",
    label: "Strategy Room",
    description: "Projections, contracts and CFO analysis",
    group: "decide",
    ownerId: "accounting-manager",
  },

  /* ── Marketing — Harper's team ───────────────────────────────────────── */
  {
    href: "/studio/social",
    label: "Social Studio",
    description: "Content plan, post library and renders",
    group: "daily",
    ownerId: "marketing-director",
    section: "studio",
    tabLabel: "Social",
  },
  {
    href: "/publish",
    label: "Publish Console",
    description: "Approved posts → Instagram, TikTok, Facebook",
    group: "decide",
    ownerId: "social-publisher",
  },
  {
    href: "/studio/announcements",
    label: "Announcement Creator",
    description: "Partner and ambassador announcement art",
    group: "daily",
    ownerId: "tilt-design",
    section: "studio",
    tabLabel: "Announcements",
  },
  {
    href: "/studio/blanket",
    label: "Blanket Fundraiser",
    description: "Team blanket renders for fundraisers",
    group: "daily",
    ownerId: "tilt-design",
    section: "studio",
    tabLabel: "Blankets",
  },
  {
    href: "/studio/promo",
    label: "Promo Video Builder",
    description: "Branded motion-graphics promos from a cut spec",
    group: "daily",
    ownerId: "video-creator",
    section: "studio",
    tabLabel: "Promo",
  },
  {
    href: "/studio/catalog",
    label: "Product Catalog",
    description: "Product imagery and catalogue assets",
    group: "daily",
    ownerId: "tilt-design",
    section: "studio",
    tabLabel: "Catalog",
  },
  {
    href: "/studio/sox",
    label: "Sock Designer",
    description: "Sock and accessory design renders",
    group: "daily",
    ownerId: "tilt-design",
    section: "studio",
    tabLabel: "Socks",
  },

  /* ── Web — Nova ──────────────────────────────────────────────────────── */
  {
    href: "/api/modules/launch?m=webadmin",
    label: "Tilt Web Admin",
    description: "The storefront's own admin — orders, customers, custom queue",
    group: "daily",
    ownerId: "web-manager",
    external: true,
  },
];

/* ── Lookups ──────────────────────────────────────────────────────────── */

export function toolsForOwner(ownerId: string): Tool[] {
  return TOOLS.filter((t) => t.ownerId === ownerId);
}

/** A section's tab strip, in registry order. */
export function tabsForSection(section: string): Tool[] {
  return TOOLS.filter((t) => t.section === section && t.tabLabel);
}

/** Tools grouped by intent, in a stable order, skipping empty groups. */
export function groupTools(tools: Tool[]): { group: ToolGroup; tools: Tool[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    tools: tools.filter((t) => t.group === group),
  })).filter((g) => g.tools.length > 0);
}

/** Everything, grouped — for the global index. */
export function allGrouped(): { group: ToolGroup; tools: Tool[] }[] {
  return groupTools(TOOLS);
}
