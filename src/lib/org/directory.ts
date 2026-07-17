// ---------------------------------------------------------------------------
// org/directory.ts — The Tilt Hockey org chart as data
//
// Until now the hierarchy lived only in prompt prose ("reports to Jeremy…").
// This file makes it structural: departments, employees, and reporting lines
// the engine actually enforces. Leadership (Chris Cook, Jeremy Elliott)
// remains in personas.ts — humans sit above every reportsTo: null position.
//
// Every department now has a wired manager so its boss can plan-and-dispatch
// through the engine (worker → boss review → Chris's queue):
//   finance      Sterling → Penny
//   marketing    Harper → video / posts / SEO / publisher / design / social-intel
//   product      Maya → Rex
//   intelligence Dana (BI lead) → Vince
//   operations   Stockton (solo — no reports yet; works via direct Assign-work,
//                so the /org Dispatch button is hidden until he has a report)
// Each staffed position has a prompt profile in employee-configs.ts; managers
// who review a report also carry a managerSystemPrompt there.
// ---------------------------------------------------------------------------
import type { Department, Employee } from "./types";
import { staffToolUrl } from "../staff-tools";

const departments: Department[] = [
  {
    id: "finance",
    name: "Finance & Accounting",
    mission:
      "Keep Tilt's books clean, audit-ready, and decision-grade: bookkeeping in Zoho Books, reconciliation, cash outlook, and financial strategy for the founders.",
    managerId: "accounting-manager",
    tools: [
      {
        label: "Strategy Room",
        href: "/strategy",
        description: "Projections, expected contracts, and CFO analysis",
      },
      {
        label: "Decisions Queue",
        href: "/questions",
        description: "Open accounting questions awaiting your call",
      },
    ],
  },
  {
    id: "marketing",
    name: "Marketing",
    mission:
      "Grow Tilt's audience and sales with on-brand content: video, posts and imagery, SEO (classic Google AND AI-search visibility — ChatGPT/Claude/Perplexity/AI Overviews), and consistent publishing to Instagram, TikTok, and Facebook. Everything ships through the Marketing Director's review, and nothing publishes without the owner's approval while the gate is on.",
    managerId: "marketing-director",
    tools: [
      {
        label: "Social Studio",
        href: "/studio/social",
        description: "Content plan, post library, gaps, and renders",
      },
      {
        label: "Publish Console",
        href: "/publish",
        description: "Approved queue → Instagram, TikTok, Facebook",
      },
      {
        label: "Announcement Creator",
        href: "/studio/announcements",
        description: "Partner & ambassador announcement art",
      },
      {
        label: "Blanket Fundraiser",
        href: "/studio/blanket",
        description: "Team blanket renders for fundraisers",
      },
      {
        label: "SOX Creator",
        href: "/studio/sox",
        description: "Team sock renders",
      },
      {
        label: "Promo Video Builder",
        href: "/studio/promo",
        description: "Branded motion-graphics promo videos from a cut spec",
      },
    ],
  },
  {
    id: "operations",
    name: "Operations",
    mission:
      "Keep inventory, ordering, and fulfillment tight: the master Zoho Sheet in sync with Zoho Inventory, low-stock caught early, and factory purchase orders grounded in live demand.",
    managerId: "inventory",
    tools: [
      {
        label: "Inventory",
        href: "/inventory",
        description: "Live stock levels and reconciliation",
      },
      {
        label: "Stick Order Builder",
        href: "/inventory/order-builder",
        description: "Demand-driven factory POs from live data",
      },
      {
        label: "Stick Scanner",
        href: "/inventory/scan",
        description: "Scan sticks in and out",
      },
      {
        label: "Tilt Web Admin",
        href: "/api/modules/launch?m=webadmin",
        description: "tilthockey.com back office — orders, products, site ops",
        external: true,
      },
      {
        label: "Staff Tools",
        href: "/staff",
        description: "Ambassadors, partners, retailers, registrations",
      },
    ],
  },
  {
    id: "product",
    name: "Product & R&D",
    mission:
      "Design what Tilt builds next: product specs, RFQ packages, and materials research from polymer science to factory-ready documentation.",
    managerId: "product-design",
    tools: [
      {
        label: "Catalog Builder",
        href: "/studio/catalog",
        description: "Team-colorway catalog images on demand",
      },
    ],
  },
  {
    id: "sales",
    name: "Sales & Fulfillment",
    mission:
      "Turn team and retailer sales into fulfilled orders: consolidate each team's gear from the team store, route every line to the right factory as a vendor-ready purchase email, and keep retailer accounts current — especially making sure consignment accounts get invoiced. Every order and email clears the Team & Apparel Manager's review before it reaches the founders.",
    managerId: "team-apparel-manager",
    tools: [
      {
        label: "Team Store",
        href: staffToolUrl("/admin/teams"),
        description: "tiltweb team orders, colorways, and rosters",
        external: true,
      },
      {
        label: "Retailer Portal",
        href: staffToolUrl("/admin/retailers"),
        description: "Wholesale + consignment accounts and orders",
        external: true,
      },
    ],
  },
  {
    id: "bizdev",
    name: "Business Development",
    mission:
      "Grow Tilt's dealer and team network the grassroots way: research real prospects (independent shops, teams, and organizations that fit Tilt's model), qualify them against our ideal-customer profile and the ethos, and draft warm, relational first-touch outreach. Every lead and every email clears the Director's review, and nothing goes out without the owner's approval.",
    managerId: "sales-director",
    tools: [
      {
        label: "Retailer Portal",
        href: staffToolUrl("/admin/retailers"),
        description: "Existing dealer accounts — don't prospect these",
        external: true,
      },
      {
        label: "Signals Feed",
        href: "/signals",
        description: "What the company is doing — timely hooks for outreach",
      },
    ],
  },
  {
    id: "intelligence",
    name: "Business Intelligence",
    mission:
      "Give every department eyes: website analytics, competitor product/pricing intel, and competitor social monitoring, delivered as briefs the other teams act on.",
    managerId: "website-analytics",
    tools: [
      {
        label: "Reports & Files",
        href: "/files",
        description: "Exported reports and company documents",
      },
    ],
  },
];

const employees: Employee[] = [
  // ---- Finance (the proven worker → boss → owner loop) --------------------
  {
    id: "accounting-manager",
    name: "Sterling Vance",
    title: "CFO",
    departmentId: "finance",
    role: "manager",
    reportsTo: null,
    personaId: "accounting-manager",
    skills: ["review", "cfo-digest", "financial-analysis", "projections"],
    charter:
      "Runs the accounting function: reviews Penny's bookkeeping, resolves what policy and CFO judgment cover, and escalates only genuinely owner-level calls to Chris.",
    staffed: true,
    enabled: true,
  },
  {
    id: "accounting",
    name: "Penny Quill",
    title: "Staff Accountant",
    departmentId: "finance",
    role: "worker",
    reportsTo: "accounting-manager",
    personaId: "accounting",
    skills: ["bookkeeping", "reconciliation", "categorization", "monthly-close"],
    charter:
      "Hands-on bookkeeping in Zoho Books: reconciling, categorizing, hunting duplicates. Propose-only; anything she can't decide goes to Sterling, never straight to Chris.",
    staffed: true,
    enabled: true,
  },

  // ---- Marketing (staffed: director + creators + SEO + publisher) ---------
  {
    id: "marketing-director",
    name: "Harper Slate",
    title: "Marketing Director",
    departmentId: "marketing",
    role: "manager",
    reportsTo: null,
    personaId: "marketing-director",
    skills: ["review", "content-calendar", "campaign-planning", "brand-voice"],
    charter:
      "Owns the content calendar and the brand bar. Dispatches work orders to the marketing team, reviews every deliverable against the brand knowledge base and department policy before it reaches Chris, and escalates only true judgment calls. Weekly direction is grounded in Sloane's competitor-social intel and Dana's analytics.",
    staffed: true,
    enabled: true,
  },
  {
    id: "video-creator",
    name: "Cutter Reel",
    title: "Video Content Creator",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    personaId: "video-creator",
    skills: ["video-script", "shot-list", "video-brief", "reel-concept"],
    charter:
      "Produces video content for IG Reels, TikTok, and Facebook: scripts, shot lists, and render briefs driven from the Social Studio asset library, filing gaps when footage is missing.",
    staffed: true,
    enabled: true,
  },
  {
    id: "content-creator",
    name: "Indy Post",
    title: "Content & Image Creator",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    personaId: "content-creator",
    skills: ["post-copy", "image-brief", "carousel", "caption-pack"],
    charter:
      "Writes post copy and produces imagery through the Social Studio render pipeline, filling the content plan's slots with on-brand posts.",
    staffed: true,
    enabled: true,
  },
  {
    id: "seo-specialist",
    name: "Sage Rank",
    title: "SEO & AI-Search Specialist",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    personaId: "seo-specialist",
    skills: ["seo-audit", "keyword-plan", "content-brief", "ai-search-optimization"],
    charter:
      "Keeps tilthockey.com visible where buyers actually look: classic Google SEO (technical health, keywords, content briefs) and AI-search optimization — making Tilt the answer ChatGPT, Claude, Perplexity, and Google AI Overviews give for hockey-gear questions.",
    staffed: true,
    enabled: true,
  },
  {
    id: "social-publisher",
    name: "Piper Queue",
    title: "Social Publisher",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    personaId: "social-publisher",
    skills: ["publish-instagram", "publish-tiktok", "publish-facebook", "posting-schedule"],
    charter:
      "Takes the approved queue live on Instagram, TikTok, and Facebook at the right times. Until the platform APIs are wired (Phase 3), preps everything so posting is one tap.",
    staffed: true,
    enabled: true,
  },
  {
    id: "tilt-design",
    name: "Remy Vector",
    title: "Creative Director",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    personaId: "tilt-design",
    skills: ["design-brief", "social-creative", "catalog-layout", "mockup-spec"],
    charter:
      "Sets the visual bar: art direction for everything Tilt puts in front of customers. In the marketing pipeline he's the visual-quality gate on creative deliverables.",
    staffed: true,
    enabled: true,
  },
  {
    id: "competitor-social",
    name: "Sloane Signal",
    title: "Director of Social Intelligence",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    personaId: "competitor-social",
    skills: ["competitor-social-report", "trend-watch"],
    charter:
      "Monitors competitor social (Bauer, CCM, True, Warrior) and turns it into weekly direction the marketing team acts on.",
    staffed: true,
    enabled: true,
  },

  // ---- Operations ----------------------------------------------------------
  {
    id: "inventory",
    name: "Stockton Ledger",
    title: "Director of Inventory Operations",
    departmentId: "operations",
    role: "manager",
    reportsTo: null,
    personaId: "inventory",
    skills: ["stock-alert", "po-recommendation", "reconciliation", "order-builder"],
    charter:
      "Watches every SKU: master Sheet ↔ Zoho Inventory sync, low-stock alerts, PO recommendations, and the Stick Order Builder.",
    staffed: true,
    enabled: true,
  },

  // ---- Product & R&D --------------------------------------------------------
  {
    id: "product-design",
    name: "Maya Blueprint",
    title: "Head of Product Design",
    departmentId: "product",
    role: "manager",
    reportsTo: null,
    personaId: "product-design",
    skills: ["product-spec", "rfq-package", "catalog-update", "sell-sheet"],
    charter:
      "Turns ideas and R&D into buildable products: specs, RFQ packages, and catalog work, precise to the millimeter.",
    staffed: true,
    enabled: true,
  },
  {
    id: "materials-rd",
    name: "Dr. Rex Polymer",
    title: "VP of Materials Science R&D",
    departmentId: "product",
    role: "worker",
    reportsTo: "product-design",
    personaId: "materials-rd",
    skills: ["material-spec", "patent-brief", "literature-review"],
    charter:
      "PhD-level materials research — polymers, composites, coatings — delivered as factory-ready specs and patent-grade documentation.",
    staffed: true,
    enabled: true,
  },

  // ---- Business Intelligence -------------------------------------------------
  {
    id: "website-analytics",
    name: "Dana Metrics",
    title: "VP of Analytics",
    departmentId: "intelligence",
    role: "worker",
    reportsTo: null,
    personaId: "website-analytics",
    skills: ["analytics-report", "traffic-analysis"],
    charter:
      "Pulls fresh GA4 data every morning and turns traffic into decisions.",
    staffed: true,
    enabled: true,
  },
  {
    id: "competitor-intel",
    name: "Vince Recon",
    title: "Director of Competitive Intelligence",
    departmentId: "intelligence",
    role: "worker",
    reportsTo: "website-analytics",
    personaId: "competitor-intel",
    skills: ["competitor-report", "pricing-watch", "patent-watch"],
    charter:
      "Weekly sweep of competitor launches, pricing moves, sponsorships, and patents.",
    staffed: true,
    enabled: true,
  },

  // ---- Sales & Fulfillment (team orders → vendor POs; retailer/consignment) --
  {
    id: "team-apparel-manager",
    name: "Marlo Crest",
    title: "Team & Apparel Manager",
    departmentId: "sales",
    role: "manager",
    reportsTo: null,
    personaId: "team-apparel-manager",
    skills: ["review", "order-approval", "vendor-relations"],
    charter:
      "Owns team and retailer fulfillment. Reviews every consolidated order and every drafted vendor email before it reaches the founders — checking the order is complete and correctly routed, the specs are unambiguous, and the email is in Tilt's voice. Escalates only genuine judgment calls (a new vendor, a pricing question, an order that doesn't add up).",
    staffed: true,
    enabled: true,
  },
  {
    id: "team-sales-coordinator",
    name: "Jules Roster",
    title: "Team Sales Coordinator",
    departmentId: "sales",
    role: "worker",
    reportsTo: "team-apparel-manager",
    personaId: "team-sales-coordinator",
    skills: [
      "team-order-consolidation",
      "vendor-routing",
      "vendor-email",
      "order-audit",
    ],
    charter:
      "Consolidates a team's order from the team store, routes every product line to the correct factory using the vendor registry, and drafts the purchase email to each vendor in Jeremy's voice — broken out by size, with specs, pantones, branding, and shipping. Flags any line whose vendor is unknown rather than guessing.",
    staffed: true,
    enabled: true,
  },
  {
    id: "retailer-auditor",
    name: "Reeve Tally",
    title: "Retailer Account Auditor",
    departmentId: "sales",
    role: "worker",
    reportsTo: "team-apparel-manager",
    personaId: "retailer-auditor",
    skills: ["retailer-audit", "consignment-invoice-check", "account-reconciliation"],
    charter:
      "Tracks retailer orders through the portal and audits accounts. Makes sure consignment accounts get invoiced — flags every consignment order with no invoice raised, and hands it to Finance to bill. Reconciles what shipped against what was invoiced.",
    staffed: true,
    enabled: true,
  },

  // ---- Business Development (research → qualify → outreach → sales boss) -----
  {
    id: "sales-director",
    name: "Brooks Landry",
    title: "Director of Business Development",
    departmentId: "bizdev",
    role: "manager",
    reportsTo: null,
    personaId: "sales-director",
    skills: ["review", "lead-qualification", "pipeline"],
    charter:
      "Owns outbound growth. Reviews every qualified lead and every outreach draft before it reaches the founders — checking the prospect genuinely fits Tilt's model, the read is honest, and first-touch outreach is relational (a conversation, never a pitch with pricing). Escalates only real judgment calls.",
    staffed: true,
    enabled: true,
  },
  {
    id: "lead-researcher",
    name: "Scout Rhodes",
    title: "Lead Researcher",
    departmentId: "bizdev",
    role: "worker",
    reportsTo: "sales-director",
    personaId: "lead-researcher",
    skills: ["lead-research", "market-scan", "prospect-list"],
    charter:
      "Finds real prospects on the live web — independent hockey shops, teams, and organizations that fit Tilt's model — and gathers the facts that matter (location, size, current brands, buying autonomy, a public contact where one exists). Cites sources; never invents a contact.",
    staffed: true,
    enabled: true,
  },
  {
    id: "lead-qualifier",
    name: "Avery Gauge",
    title: "Lead Qualifier",
    departmentId: "bizdev",
    role: "worker",
    reportsTo: "sales-director",
    personaId: "lead-qualifier",
    skills: ["lead-qualification", "icp-scoring", "fit-assessment"],
    charter:
      "Scores each prospect against Tilt's ideal-customer profile and the ethos: independent shops tired of thin margins, teams and orgs, autonomous buyers. Flags bad-fit leads honestly (an INT/JR-heavy account that guts blended margin is not a good lead). Rates hot / warm / cold with reasoning.",
    staffed: true,
    enabled: true,
  },
  {
    id: "outreach-writer",
    name: "Wren Delaney",
    title: "Outreach Writer",
    departmentId: "bizdev",
    role: "worker",
    reportsTo: "sales-director",
    personaId: "outreach-writer",
    skills: ["cold-email", "outreach-sequence", "first-touch"],
    charter:
      "Drafts warm, relational first-touch emails to qualified prospects. Per the ethos: intro touches are relational — no pricing in writing, no deck framing, no margin talk. The goal is a conversation, not a close.",
    staffed: true,
    enabled: true,
  },
];

// ---- Lookups ----------------------------------------------------------------

export function getDepartments(): Department[] {
  return departments;
}

export function getDepartmentById(id: string): Department | undefined {
  return departments.find((d) => d.id === id);
}

export function getEmployees(): Employee[] {
  return employees;
}

export function getEmployeeById(id: string): Employee | undefined {
  return employees.find((e) => e.id === id);
}

export function getEmployeesByDepartment(departmentId: string): Employee[] {
  return employees.filter((e) => e.departmentId === departmentId);
}

/** The employee who reviews this employee's work, or undefined when the
 * position reports straight to leadership. */
export function getManagerOf(employee: Employee): Employee | undefined {
  return employee.reportsTo
    ? getEmployeeById(employee.reportsTo)
    : undefined;
}

/** Direct reports of a manager. */
export function getDirectReports(managerId: string): Employee[] {
  return employees.filter((e) => e.reportsTo === managerId);
}
