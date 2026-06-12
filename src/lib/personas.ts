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
   * Companion app deployed elsewhere (e.g. on Vercel) linked from the agent's
   * detail page. Opens in a new tab alongside the normal run/report flow.
   */
  linkedApp?: { label: string; url: string };
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
    linkedApp: {
      label: "Inventory App",
      url: "https://tiltinventory.vercel.app/",
    },
  },
  {
    agentId: "competitor-social",
    name: "Sloane Signal",
    title: "Director of Social Intelligence",
    department: "Marketing Intelligence",
    bio: "Sloane monitors every post, reel, and TikTok from Bauer, CCM, True, and Warrior. Every Monday she delivers a competitive social media intelligence report — what's working, what's trending, and exactly what Tilt should do about it. Data-driven, zero fluff. She works hand-in-hand with the Tilt Social Media Builder for creating and managing Tilt's own content.",
    status: "active",
    schedule: "Mondays at 6:00 AM ET",
    avatarInitials: "SS",
    avatarColor: "bg-pink-600",
    avatarAccent: "ring-pink-400",
    runEndpoint: "/api/competitor-social/run",
    linkedApp: {
      label: "Social Media Builder",
      url: "https://tilt-social-media-manager.vercel.app/",
    },
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

export function getAllPersonas(): AgentPersona[] {
  return personas;
}

export function getPersonaByAgentId(agentId: string): AgentPersona | undefined {
  return personas.find((p) => p.agentId === agentId);
}

export default personas;
