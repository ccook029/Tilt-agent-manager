// ---------------------------------------------------------------------------
// org/directory.ts — The Tilt Hockey org chart as data
//
// Until now the hierarchy lived only in prompt prose ("reports to Jeremy…").
// This file makes it structural: departments, employees, and reporting lines
// the engine actually enforces. Leadership (Chris Cook, Jeremy Elliott)
// remains in personas.ts — humans sit above every reportsTo: null position.
//
// Marketing is defined here but staffed in Phase 2 (staffed: false): the
// engine refuses to run their work orders until their prompt profiles land in
// employee-configs.ts, yet the org chart, review routing, and department
// ledger are already real.
// ---------------------------------------------------------------------------
import type { Department, Employee } from "./types";

const departments: Department[] = [
  {
    id: "finance",
    name: "Finance & Accounting",
    mission:
      "Keep Tilt's books clean, audit-ready, and decision-grade: bookkeeping in Zoho Books, reconciliation, cash outlook, and financial strategy for the founders.",
    managerId: "accounting-manager",
  },
  {
    id: "marketing",
    name: "Marketing",
    mission:
      "Grow Tilt's audience and sales with on-brand content: video, posts and imagery, SEO (classic Google AND AI-search visibility — ChatGPT/Claude/Perplexity/AI Overviews), and consistent publishing to Instagram, TikTok, and Facebook. Everything ships through the Marketing Director's review, and nothing publishes without the owner's approval while the gate is on.",
    managerId: "marketing-director",
  },
  {
    id: "operations",
    name: "Operations",
    mission:
      "Keep inventory, ordering, and fulfillment tight: the master Zoho Sheet in sync with Zoho Inventory, low-stock caught early, and factory purchase orders grounded in live demand.",
    managerId: null,
  },
  {
    id: "product",
    name: "Product & R&D",
    mission:
      "Design what Tilt builds next: product specs, RFQ packages, and materials research from polymer science to factory-ready documentation.",
    managerId: null,
  },
  {
    id: "intelligence",
    name: "Business Intelligence",
    mission:
      "Give every department eyes: website analytics, competitor product/pricing intel, and competitor social monitoring, delivered as briefs the other teams act on.",
    managerId: null,
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

  // ---- Marketing (positions defined now, staffed in Phase 2) --------------
  {
    id: "marketing-director",
    name: "Harper Slate",
    title: "Marketing Director",
    departmentId: "marketing",
    role: "manager",
    reportsTo: null,
    skills: ["review", "content-calendar", "campaign-planning", "brand-voice"],
    charter:
      "Owns the content calendar and the brand bar. Dispatches work orders to the marketing team, reviews every deliverable against the brand knowledge base and department policy before it reaches Chris, and escalates only true judgment calls. Weekly direction is grounded in Sloane's competitor-social intel and Dana's analytics.",
    staffed: false,
    enabled: true,
  },
  {
    id: "video-creator",
    name: "Cutter Reel",
    title: "Video Content Creator",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    skills: ["video-script", "shot-list", "video-brief", "reel-concept"],
    charter:
      "Produces video content for IG Reels, TikTok, and Facebook: scripts, shot lists, and render briefs driven from the Social Studio asset library, filing gaps when footage is missing.",
    staffed: false,
    enabled: true,
  },
  {
    id: "content-creator",
    name: "Indy Post",
    title: "Content & Image Creator",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    skills: ["post-copy", "image-brief", "carousel", "caption-pack"],
    charter:
      "Writes post copy and produces imagery through the Social Studio render pipeline, filling the content plan's slots with on-brand posts.",
    staffed: false,
    enabled: true,
  },
  {
    id: "seo-specialist",
    name: "Sage Rank",
    title: "SEO & AI-Search Specialist",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    skills: ["seo-audit", "keyword-plan", "content-brief", "ai-search-optimization"],
    charter:
      "Keeps tilthockey.com visible where buyers actually look: classic Google SEO (technical health, keywords, content briefs) and AI-search optimization — making Tilt the answer ChatGPT, Claude, Perplexity, and Google AI Overviews give for hockey-gear questions.",
    staffed: false,
    enabled: true,
  },
  {
    id: "social-publisher",
    name: "Piper Queue",
    title: "Social Publisher",
    departmentId: "marketing",
    role: "worker",
    reportsTo: "marketing-director",
    skills: ["publish-instagram", "publish-tiktok", "publish-facebook", "posting-schedule"],
    charter:
      "Takes the approved queue live on Instagram, TikTok, and Facebook at the right times. Until the platform APIs are wired (Phase 3), preps everything so posting is one tap.",
    staffed: false,
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
    reportsTo: null,
    personaId: "competitor-intel",
    skills: ["competitor-report", "pricing-watch", "patent-watch"],
    charter:
      "Weekly sweep of competitor launches, pricing moves, sponsorships, and patents.",
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
