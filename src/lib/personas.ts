// ---------------------------------------------------------------------------
// Agent Personas — Tilt Corporate Headquarters
//
// Each agent has a persona with a name, title, department, avatar, and bio.
// Used across the dashboard, detail pages, and home page.
// ---------------------------------------------------------------------------

export interface AgentPersona {
  agentId: string;
  name: string;
  title: string;
  department: string;
  bio: string;
  status: "active" | "standby";
  schedule: string; // human-readable
  avatarInitials: string;
  avatarColor: string; // tailwind bg class
  avatarAccent: string; // tailwind ring/border class
  runEndpoint: string;
  taskTypes?: string[];
  /**
   * Standalone deployed tool launched in a new tab (rather than a Claude
   * pipeline that produces emailed reports). When set, the dashboard shows an
   * "open" button pointing at this server-side route instead of a "Run Now"
   * trigger, and never expects run history.
   */
  external?: boolean;
  launchUrl?: string;
  /**
   * Design / creative tools this agent hands work off to. Rendered as a
   * "Design Tools" panel on the agent's detail page. Internal hrefs (e.g.
   * /api/catalog/launch) inject access keys server-side; external links open
   * the vendor app in a new tab.
   */
  tools?: { label: string; href: string; description?: string; external?: boolean }[];
}

// Leadership — Co-Founders (not AI agents, real humans at the top)
export interface LeaderPersona {
  name: string;
  title: string;
  avatarInitials: string;
  avatarColor: string;
  avatarAccent: string;
}

const leadership: LeaderPersona[] = [
  {
    name: "Chris Cook",
    title: "Co-Founder",
    avatarInitials: "CC",
    avatarColor: "bg-[#0094b8]",
    avatarAccent: "ring-[#00d6ff]",
  },
  {
    name: "Jeremy Elliott",
    title: "Co-Founder",
    avatarInitials: "JE",
    avatarColor: "bg-[#0094b8]",
    avatarAccent: "ring-[#00d6ff]",
  },
];

export function getLeadership(): LeaderPersona[] {
  return leadership;
}

const personas: AgentPersona[] = [
  {
    agentId: "website-analytics",
    name: "Dana Metrics",
    title: "VP of Analytics",
    department: "Business Intelligence",
    bio: "Dana lives and breathes numbers. Every morning she pulls fresh GA4 data, dissects traffic patterns, and delivers insights before anyone's finished their coffee. Monday reports cover the weekend — she never misses a beat.",
    status: "active",
    schedule: "Weekdays at 8:00 AM ET",
    avatarInitials: "DM",
    avatarColor: "bg-blue-600",
    avatarAccent: "ring-blue-400",
    runEndpoint: "/api/analytics/run",
  },
  {
    agentId: "competitor-intel",
    name: "Vince Recon",
    title: "Director of Competitive Intelligence",
    department: "Strategy",
    bio: "Vince keeps his ear to the ground. Every Wednesday he scans Bauer, CCM, True, Warrior, and the rest — tracking new launches, pricing moves, sponsorship deals, and patent filings. If the competition blinks, Vince sees it.",
    status: "active",
    schedule: "Wednesdays at 8:00 AM ET",
    avatarInitials: "VR",
    avatarColor: "bg-amber-600",
    avatarAccent: "ring-amber-400",
    runEndpoint: "/api/competitors/run",
  },
  {
    agentId: "product-design",
    name: "Maya Blueprint",
    title: "Head of Product Design",
    department: "Product Development",
    bio: "Maya never stops thinking about what's next. She autonomously researches new product concepts, then brings you fully-formed ideas with specs, materials, and market rationale. You can also talk to her directly for specs, RFQs, or catalog work. Precise to the millimeter, no buzzwords allowed.",
    status: "active",
    schedule: "Mondays at 8:00 AM ET + On-demand",
    avatarInitials: "MB",
    avatarColor: "bg-emerald-600",
    avatarAccent: "ring-emerald-400",
    runEndpoint: "/api/product-design/run",
    taskTypes: ["product-spec", "rfq-package", "catalog-update", "rendering-brief", "sell-sheet"],
  },
  {
    agentId: "tilt-design",
    name: "Remy Vector",
    title: "Creative Director",
    department: "Brand & Design Studio",
    bio: "Remy makes everything Tilt look unmistakably Tilt. Catalog spreads, social creative, blanket and merch drops, mockup direction — Remy turns a brief into production-ready art direction and hands it straight to the right tool. Where Maya answers 'can we build it?', Remy answers 'does it look like us?'. Tilt Blue, athletic type, zero buzzwords.",
    status: "active",
    schedule: "On-demand",
    avatarInitials: "RV",
    avatarColor: "bg-indigo-600",
    avatarAccent: "ring-indigo-400",
    runEndpoint: "/api/tilt-design/run",
    taskTypes: ["design-brief", "blanket-design", "catalog-layout", "production-spec", "social-creative", "mockup-spec"],
    tools: [
      {
        label: "Catalog Builder",
        href: "/api/catalog/launch",
        description: "Team-colorway catalog images via Gemini (in-house)",
        external: true,
      },
    ],
  },
  {
    agentId: "materials-rd",
    name: "Dr. Rex Polymer",
    title: "VP of Materials Science R&D",
    department: "Research & Development",
    bio: "Rex operates at PhD level in polymer science, advanced composites, and sports equipment engineering. He researches UHMWPE formulations, graphene reinforcement, variable-flex systems, and advanced coatings — then delivers factory-ready material specs and patent-grade documentation. Reports to Jeremy Elliott with findings escalated to Chris Cook.",
    status: "active",
    schedule: "Fridays at 8:00 AM ET + On-demand",
    avatarInitials: "RP",
    avatarColor: "bg-purple-600",
    avatarAccent: "ring-purple-400",
    runEndpoint: "/api/materials-rd/research",
    taskTypes: ["material-spec", "patent-brief", "literature-review", "competitor-ip-scan", "factory-rnd-memo"],
  },
  {
    agentId: "inventory",
    name: "Stockton Ledger",
    title: "Director of Inventory Operations",
    department: "Operations",
    bio: "Stockton watches every SKU like a hawk. He monitors both the master Zoho Sheet (source of truth) and Zoho Inventory, keeping them in sync. He flags low-stock items before they become problems, recommends purchase orders based on sales velocity, and delivers weekly inventory health reports. Nothing ships without Stockton knowing about it first.",
    status: "active",
    schedule: "Weekdays at 7:00 AM ET + Weekly Report Mondays",
    avatarInitials: "SL",
    avatarColor: "bg-cyan-600",
    avatarAccent: "ring-cyan-400",
    runEndpoint: "/api/inventory/run",
    taskTypes: ["stock-alert", "po-recommendation", "sku-audit", "shipment-tracker", "inventory-reconciliation", "sheet-reconciliation", "sheet-sync"],
  },
  {
    agentId: "accounting-manager",
    name: "Sterling Vance",
    title: "Chief Financial Officer",
    department: "Finance & Accounting",
    bio: "Sterling runs Tilt's books like an audit is next week. He reviews every piece of Penny's bookkeeping, makes the accounting calls so Chris doesn't have to, and escalates only the decisions that genuinely need the CEO — batched into a daily digest. Every answer Chris gives becomes standing policy, so Sterling never asks the same question twice. GAAP-minded, conservative, dry as a ledger.",
    status: "active",
    schedule: "Daily digest + On-demand chat",
    avatarInitials: "SV",
    avatarColor: "bg-slate-600",
    avatarAccent: "ring-slate-400",
    runEndpoint: "/api/accounting-manager/run",
  },
  {
    agentId: "accounting",
    name: "Penny Quill",
    title: "Staff Accountant",
    department: "Finance & Accounting",
    bio: "Penny is a master bookkeeper doing the hands-on work in Zoho Books — reconciling accounts, categorizing transactions, hunting duplicates, cleaning up the chart of accounts. Right now she's running a multi-year catch-up cleanup: trust nothing, verify everything, escalate liberally. She never bugs Chris directly; anything she can't decide, she takes to Sterling. Propose-only by design: Penny recommends, humans approve.",
    status: "active",
    schedule: "Weekdays at 7:00 AM ET + On-demand",
    avatarInitials: "PQ",
    avatarColor: "bg-teal-600",
    avatarAccent: "ring-teal-400",
    runEndpoint: "/api/accounting/run",
    taskTypes: [
      "auto-categorize",
      "books-health",
      "catch-up-plan",
      "bank-reconciliation",
      "categorize-transactions",
      "coa-audit",
      "ar-cleanup",
      "ap-cleanup",
      "ar-collections",
      "cash-outlook",
      "inventory-tieout",
      "sales-tax-review",
      "monthly-close",
    ],
  },
  {
    agentId: "competitor-social",
    name: "Sloane Signal",
    title: "Director of Social Intelligence",
    department: "Marketing Intelligence",
    bio: "Sloane monitors every post, reel, and TikTok from Bauer, CCM, True, and Warrior. Every Monday she delivers a competitive social media intelligence report — what's working, what's trending, and exactly what Tilt should do about it. Data-driven, zero fluff.",
    status: "active",
    schedule: "Mondays at 6:00 AM ET",
    avatarInitials: "SS",
    avatarColor: "bg-pink-600",
    avatarAccent: "ring-pink-400",
    runEndpoint: "/api/competitor-social/run",
  },
  {
    agentId: "catalog-builder",
    name: "Catalog Builder",
    title: "Catalog Image Studio",
    department: "Product Design",
    bio: "Catalog Builder turns a team name, colors, and an uploaded jersey or logo into rendered Tilt catalog product images. Powered by Gemini, it generates on-brand catalog imagery on demand — open it, feed it a team, and get catalog-ready shots back in seconds.",
    status: "active",
    schedule: "On-demand",
    avatarInitials: "CB",
    avatarColor: "bg-sky-600",
    avatarAccent: "ring-[#00D6FF]",
    runEndpoint: "/api/catalog/launch",
    external: true,
    launchUrl: "/api/catalog/launch",
  },
];

// ---- Tilt OS modules — satellite tools federated into HQ ------------------
// Launched via /api/modules/launch (server-side key injection). Set the
// matching *_APP_URL env var in Vercel to activate each card.

personas.push(
  {
    agentId: "social-studio",
    name: "Tilt Social Studio",
    title: "Social Content Creator",
    department: "Marketing Studio",
    bio: "The Tilt social media content creator — plans, drafts, and produces on-brand social content. Absorbed into HQ: it now runs natively at /studio/social behind the OS login, and its updates post straight into the Morning Brief signals inbox.",
    status: "active",
    schedule: "On-demand",
    avatarInitials: "TS",
    avatarColor: "bg-pink-700",
    avatarAccent: "ring-pink-400",
    runEndpoint: "/studio/social",
    // Still an "open the tool" persona (no scheduled pipeline/run history
    // yet), but the launch URL is the native module page inside HQ.
    external: true,
    launchUrl: "/studio/social",
  },
  {
    agentId: "web-admin",
    name: "Tilt Web Admin",
    title: "Website Backend",
    department: "Web Operations",
    bio: "The tilthockey.com backend admin — orders, products, and site operations. Runs as its own module; launch it from here, and its updates flow into the Morning Brief via the Tilt OS signals inbox.",
    status: "active",
    schedule: "On-demand",
    avatarInitials: "TW",
    avatarColor: "bg-orange-700",
    avatarAccent: "ring-orange-400",
    runEndpoint: "/api/modules/launch?m=webadmin",
    external: true,
    launchUrl: "/api/modules/launch?m=webadmin",
  }
);

export function getAllPersonas(): AgentPersona[] {
  return personas;
}

export function getPersonaByAgentId(agentId: string): AgentPersona | undefined {
  return personas.find((p) => p.agentId === agentId);
}

export default personas;
