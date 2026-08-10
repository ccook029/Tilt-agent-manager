// ---------------------------------------------------------------------------
// org/wiring.ts — what each employee is CONNECTED to, verifiable live.
//
// This is the "open the panel and look at the lights" layer for the agent
// audit: every employee gets a list of the data pipes and tools their prompts
// actually inject (mirroring department-context.ts / agent-chat.ts special
// cases), each with a live check() that fetches the real source and returns a
// short PROOF line ("14 policies · 3 open questions") — or throws, which the
// API reports as a red light. Plus a static "produces" list: what this person
// outputs and where it lands.
//
// Keep this file in sync with department-context.ts when feeds change — it is
// the user-facing mirror of that wiring.
// ---------------------------------------------------------------------------
import { getCachedBooksSnapshot } from "../books-snapshot";
import { getCachedSalesSnapshot } from "../sales-snapshot";
import { getCompanySnapshot } from "../company-snapshot";
import { fetchInventorySnapshot } from "../zoho";
import { fetchSheetSnapshot } from "../zoho-sheet";
import { fetchSyncReport } from "../zoho-sync";
import { fetchGA4Data, getWeekRange } from "../ga4";
import { isGscConfigured, fetchSearchConsoleData } from "../gsc";
import { getRecentSignals } from "../signals";
import { getOwnerQueue } from "./work-orders";
import { getPolicies, getOpenEscalations } from "../policy-ledger";
import { renderTeamOrdersSnapshot } from "../sales/team-orders";
import { renderConsignmentSnapshot } from "../sales/retailers";
import { renderRecentInvoicesSnapshot } from "../sales/invoices";
import { listShipments } from "../supply/shipments";
import { buildProductionStatus } from "../supply/production";
import { renderMarketingContext } from "./marketing-context";
import { renderOrderBuilderContext } from "../order-builder/logic";
import { renderWebContext } from "./web-context";
import { websiteRepoConfigured } from "../web/github";
import { VENDORS } from "./vendors";
import { getRunLogsByAgent } from "../store";
import { getEmployeeById } from "./directory";
import { fetchUncategorizedBankTxns } from "../zoho-books";

export interface WiringFeed {
  id: string;
  label: string;
  /** Plain words: what flows through this pipe into the agent's head. */
  description: string;
  kind: "data" | "tool" | "action";
  /**
   * Fetch the real source and return a short proof line. Throw → red light.
   * Return { warn } → amber light (works, with a caveat / known gap).
   */
  check: () => Promise<string | { warn: string }>;
}

export interface WiringCheckResult {
  id: string;
  label: string;
  description: string;
  kind: WiringFeed["kind"];
  status: "ok" | "warn" | "fail";
  note: string;
  ms: number;
}

export interface EmployeeWiring {
  feeds: WiringFeed[];
  /** What this person outputs and where it lands. Static, human-readable. */
  produces: string[];
}

// ---- helpers ---------------------------------------------------------------

/** Proof line from a text blob: size + its first meaningful line. */
function textProof(s: string): string {
  const t = (s ?? "").trim();
  if (t.length < 40) throw new Error("came back empty — the source returned no data");
  const firstLine =
    t
      .split("\n")
      .map((l) => l.replace(/^[=#\-\s]+|[=\s]+$/g, "").trim())
      .find((l) => l.length > 8) ?? "";
  return `${t.length.toLocaleString()} chars · “${firstLine.slice(0, 90)}${firstLine.length > 90 ? "…" : ""}”`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms)
    ),
  ]);
}

// ---- feed factories (shared across employees) ------------------------------

const booksFeed = (): WiringFeed => ({
  id: "zoho-books",
  label: "Zoho Books — live books",
  description: "Cash position, A/R, A/P, uncategorized transactions (cached snapshot, refreshes ~25 min).",
  kind: "data",
  check: async () => textProof(await getCachedBooksSnapshot()),
});

const salesFeed = (): WiringFeed => ({
  id: "sales",
  label: "Sales — Zoho Books invoices",
  description: "Real revenue: last 7 days / this month / last 30 days, stick counts, recent orders.",
  kind: "data",
  check: async () => textProof(await getCachedSalesSnapshot()),
});

const inventoryFeed = (): WiringFeed => ({
  id: "zoho-inventory",
  label: "Zoho Inventory snapshot",
  description: "Stock on hand, low-stock flags, open sales orders and purchase orders.",
  kind: "data",
  check: async () => textProof(await fetchInventorySnapshot()),
});

const sheetFeed = (): WiringFeed => ({
  id: "master-sheet",
  label: "Master Zoho Sheet",
  description: "The stick-count source of truth (per-serial rows, custom tabs included).",
  kind: "data",
  check: async () => textProof(await fetchSheetSnapshot()),
});

const syncFeed = (): WiringFeed => ({
  id: "sheet-sync",
  label: "Sheet ↔ Inventory reconciliation",
  description: "Where the master Sheet and Zoho Inventory disagree, line by line.",
  kind: "data",
  check: async () => textProof(await fetchSyncReport()),
});

const shipmentsFeed = (): WiringFeed => ({
  id: "shipments",
  label: "Shipment register",
  description: "Open inbound shipments with timelines; overdue/at-risk flags.",
  kind: "data",
  check: async () => {
    const list = await listShipments();
    return `${list.length} shipment${list.length === 1 ? "" : "s"} on the register`;
  },
});

const productionFeed = (): WiringFeed => ({
  id: "production",
  label: "Under-production status",
  description: "What the website shows as being made, with public ETAs per line.",
  kind: "data",
  check: async () => {
    const items = await buildProductionStatus();
    return `${items.length} production line${items.length === 1 ? "" : "s"} tracked`;
  },
});

const ga4Feed = (): WiringFeed => ({
  id: "ga4",
  label: "Google Analytics (GA4)",
  description: "tilthockey.com traffic — sessions, sources, top pages, conversions.",
  kind: "data",
  check: async () => textProof(await fetchGA4Data(getWeekRange(new Date()))),
});

const gscFeed = (): WiringFeed => ({
  id: "gsc",
  label: "Google Search Console",
  description: "Search queries, clicks, impressions, and page rankings for tilthockey.com.",
  kind: "data",
  check: async () => {
    if (!isGscConfigured())
      throw new Error("not configured — add the GSC_* env vars in Vercel");
    return textProof(await fetchSearchConsoleData(7));
  },
});

const signalsFeed = (): WiringFeed => ({
  id: "signals",
  label: "Company signals feed",
  description: "One-line events from every Tilt tool (sales, publishes, runs) — the last 7 days.",
  kind: "data",
  check: async () => {
    const s = await getRecentSignals(24 * 7);
    return s.length === 0
      ? { warn: "connected, but no signals in the last 7 days (quiet week or feeders down)" }
      : `${s.length} signals this week · latest: “${s[0].headline.slice(0, 70)}”`;
  },
});

const ownerQueueFeed = (): WiringFeed => ({
  id: "owner-queue",
  label: "Founders' review queue",
  description: "Boss-approved work waiting on you + escalated questions, across all departments.",
  kind: "data",
  check: async () => {
    const q = await getOwnerQueue();
    const approved = q.filter((o) => o.status === "approved").length;
    const escalated = q.filter((o) => o.status === "escalated").length;
    return `${approved} awaiting your approval · ${escalated} escalated question${escalated === 1 ? "" : "s"}`;
  },
});

const policyLedgerFeed = (): WiringFeed => ({
  id: "policy-ledger",
  label: "Accounting policy ledger",
  description: "Every accounting rule you've ever decided (treated as law) + open questions for you.",
  kind: "data",
  check: async () => {
    const [policies, open] = await Promise.all([getPolicies(), getOpenEscalations()]);
    return `${policies.length} standing policies · ${open.length} question${open.length === 1 ? "" : "s"} awaiting you`;
  },
});

const uncategorizedFeed = (): WiringFeed => ({
  id: "uncategorized-backlog",
  label: "Uncategorized backlog (direct from the bank feeds)",
  description:
    "The exact transaction list Penny's categorization runs work from — filtered to genuinely uncategorized lines.",
  kind: "data",
  check: async () => {
    const { items, total } = await fetchUncategorizedBankTxns(5);
    if (total === 0) return "backlog clear — 0 uncategorized transactions";
    const statuses = items.map((t) => String(t.status ?? "?").toLowerCase());
    const wrong = statuses.filter((s) => s && s !== "uncategorized" && s !== "?");
    if (wrong.length > 0)
      return {
        warn: `~${total} total, but sample contains non-uncategorized lines (${wrong.join(", ")}) — the Zoho filter isn't holding`,
      };
    return `~${total} uncategorized · sample of ${items.length} verified genuinely uncategorized`;
  },
});

const companySnapshotFeed = (): WiringFeed => ({
  id: "company-snapshot",
  label: "Whole-company snapshot",
  description: "Books + sales + inventory + signals + activity + escalations, assembled into one live brief.",
  kind: "data",
  check: async () => textProof(await getCompanySnapshot()),
});

const teamOrdersFeed = (): WiringFeed => ({
  id: "team-orders",
  label: "Team-store orders (tilthockey.com)",
  description: "Open team apparel orders from the storefront, ready to consolidate and route to vendors.",
  kind: "data",
  check: async () => textProof(await renderTeamOrdersSnapshot()),
});

const consignmentFeed = (): WiringFeed => ({
  id: "consignment",
  label: "Consignment accounts (tilthockey.com)",
  description: "Retailer consignment stock and billable months — what SHOULD be invoiced.",
  kind: "data",
  check: async () => textProof(await renderConsignmentSnapshot()),
});

const invoicesFeed = (): WiringFeed => ({
  id: "invoices",
  label: "Zoho Books — recent invoices",
  description: "What actually WAS invoiced — matched against billable months to find gaps.",
  kind: "data",
  check: async () => textProof(await renderRecentInvoicesSnapshot()),
});

const marketingCtxFeed = (): WiringFeed => ({
  id: "marketing-context",
  label: "Marketing workspace",
  description: "Brand bar, content plan and gaps, asset library, competitor social intel.",
  kind: "data",
  check: async () => textProof(await renderMarketingContext({ includeAnalytics: false })),
});

const orderBuilderFeed = (): WiringFeed => ({
  id: "order-builder",
  label: "Stick Order Builder",
  description: "The allocator's live dataset — demand, stock groups, custom queue — and its economics.",
  kind: "tool",
  check: async () => textProof(await renderOrderBuilderContext()),
});

const webContextFeed = (): WiringFeed => ({
  id: "web-context",
  label: "Storefront file map",
  description: "The map of tilthockey.com's code so changes target the right file.",
  kind: "data",
  check: async () => textProof(renderWebContext()),
});

const webPrFeed = (): WiringFeed => ({
  id: "web-pr",
  label: "Pull-request opener",
  description: "Turns an agreed change into a real PR against the storefront repo (a human merges).",
  kind: "action",
  check: async () => {
    if (!websiteRepoConfigured())
      throw new Error(
        "not configured — add GITHUB_TOKEN (contents + PR write on the storefront repo) in Vercel"
      );
    return "configured — Open-PR button in Nova's chat is live";
  },
});

const vendorRegistryFeed = (): WiringFeed => ({
  id: "vendors",
  label: "Vendor registry",
  description: "Who Tilt orders each product category from, with emails and Jeremy's conventions.",
  kind: "data",
  check: async () => {
    const n = Object.keys(VENDORS).length;
    return `${n} vendors on file (${Object.values(VENDORS)
      .slice(0, 3)
      .map((v) => v.company)
      .join(", ")}…)`;
  },
});

const webSearchFeed = (): WiringFeed => ({
  id: "web-search",
  label: "Live web search",
  description: "Anthropic server-side web search — real prospects, events, and research with citations.",
  kind: "tool",
  check: async () => "enabled for this role's drafts",
});

const cxClaimsFeed = (): WiringFeed => ({
  id: "warranty-claims",
  label: "Live warranty-claim feed",
  description: "Claims submitted on tilthockey.com flowing straight into CX triage.",
  kind: "data",
  check: async () => ({
    warn: "not wired yet — CX only sees claims you paste into a brief. (Needs a tiltweb endpoint, like the custom-orders feed.)",
  }),
});

/** The freshest successful report from a set of sibling agents' run logs. */
const findingsFeed = (label: string, agentIds: string[]): WiringFeed => ({
  id: `findings-${agentIds[0]}`,
  label,
  description: `Latest successful reports from: ${agentIds.join(", ")}.`,
  kind: "data",
  check: async () => {
    const found: string[] = [];
    for (const id of agentIds) {
      const logs = await getRunLogsByAgent(id).catch(() => []);
      const latest = logs.find((l) => l.status === "success");
      if (latest) found.push(`${id} (${latest.startedAt.slice(0, 10)})`);
    }
    if (found.length === 0)
      return { warn: "connected, but no recent reports on file — run one of these agents to populate it" };
    return `fresh reports from ${found.join(" · ")}`;
  },
});

// ---- the per-employee wiring map -------------------------------------------

const WIRING: Record<string, EmployeeWiring> = {
  // Executive
  "chief-of-staff": {
    feeds: [companySnapshotFeed(), ownerQueueFeed(), signalsFeed()],
    produces: [
      "Founder briefings (ranked decisions, shipped, stuck, this week's few) → your /review queue",
      "Voice + chat answers grounded in the whole-company snapshot",
      "Dispatches work to any department head from chat",
    ],
  },

  // Finance
  "accounting-manager": {
    feeds: [booksFeed(), salesFeed(), policyLedgerFeed()],
    produces: [
      "Reviews of Penny's and June's work (CFO bar) → escalates only owner-level calls",
      "Daily CFO digest email to Chris",
      "Dispatches Penny's 13 task types from chat; records your answers as standing policy",
    ],
  },
  accounting: {
    feeds: [booksFeed(), uncategorizedFeed(), salesFeed(), policyLedgerFeed()],
    produces: [
      "Bookkeeping runs (categorization, reconciliation, cleanups) → Report History",
      "Guardrailed auto-categorization writes in Zoho Books (weekday cron)",
      "Decision requests → Sterling (never straight to you)",
    ],
  },
  "cash-flow-analyst": {
    feeds: [booksFeed()],
    produces: [
      "Cash-runway, projection, and margin analyses → Sterling's CFO review → your queue",
    ],
  },

  // Marketing
  "marketing-director": {
    feeds: [marketingCtxFeed(), ga4Feed()],
    produces: [
      "Period content plans; dispatches work orders to the whole marketing team",
      "Brand-bar reviews of every piece → your /review queue",
    ],
  },
  "video-creator": {
    feeds: [marketingCtxFeed()],
    produces: [
      "Reel/TikTok scripts + shot lists; shipped work auto-creates Studio posts + renders",
    ],
  },
  "content-creator": {
    feeds: [marketingCtxFeed()],
    produces: [
      "Captions + image briefs; shipped work auto-creates Studio posts + renders",
    ],
  },
  "seo-specialist": {
    feeds: [marketingCtxFeed(), ga4Feed(), gscFeed()],
    produces: ["SEO/AI-search audits and content briefs → /files"],
  },
  "social-publisher": {
    feeds: [marketingCtxFeed()],
    produces: ["Publishing plans for the approved queue → /publish console (IG, TikTok, FB)"],
  },
  "tilt-design": {
    feeds: [marketingCtxFeed()],
    produces: ["Design briefs, art direction, production specs; Catalog Builder for imagery"],
  },
  "competitor-social": {
    feeds: [marketingCtxFeed(), signalsFeed()],
    produces: ["Monday competitor-social intel report (Bauer/CCM/True/Warrior) → run history"],
  },

  // Operations
  inventory: {
    feeds: [sheetFeed(), syncFeed(), inventoryFeed(), shipmentsFeed(), productionFeed(), orderBuilderFeed()],
    produces: [
      "Daily Sheet↔Inventory reconciliation (real sync writes) + Monday inventory report",
      "PO recommendations from sales velocity; costed factory orders via Order Builder",
    ],
  },
  "supply-coordinator": {
    feeds: [shipmentsFeed(), productionFeed(), webSearchFeed()],
    produces: ["Shipment tracking summaries; drafted vendor check-in emails → your queue"],
  },

  // Product & R&D
  "product-design": {
    feeds: [findingsFeed("Team research findings", ["materials-rd", "product-design", "competitor-intel"])],
    produces: ["Product specs, RFQ packages, catalog updates; Monday innovation concepts"],
  },
  "materials-rd": {
    feeds: [findingsFeed("Team research findings", ["materials-rd", "product-design", "competitor-intel"]), webSearchFeed()],
    produces: ["Friday materials-science research scans; factory-ready material specs"],
  },

  // Sales & Fulfillment
  "team-apparel-manager": {
    feeds: [teamOrdersFeed(), consignmentFeed(), invoicesFeed(), vendorRegistryFeed()],
    produces: ["Reviews of vendor orders + audits before they reach you"],
  },
  "team-sales-coordinator": {
    feeds: [teamOrdersFeed(), vendorRegistryFeed()],
    produces: [
      "Ready-to-send vendor order emails (Jeremy's voice, per product per vendor) → your queue",
    ],
  },
  "retailer-auditor": {
    feeds: [consignmentFeed(), invoicesFeed()],
    produces: ["Un-invoiced consignment month findings → handed to Finance to bill"],
  },

  // CX
  "cx-manager": {
    feeds: [signalsFeed(), cxClaimsFeed()],
    produces: ["CX triage dispatches; reviews of warranty decisions before a human sends them"],
  },
  "warranty-specialist": {
    feeds: [signalsFeed(), cxClaimsFeed()],
    produces: [
      "Warranty decisions (approve/swap/decline vs policy) + customer-ready reply emails → your queue",
    ],
  },

  // BizDev
  "sales-director": {
    feeds: [signalsFeed(), webSearchFeed()],
    produces: ["Prospecting plans; dispatches the bizdev team; reviews before your queue"],
  },
  "lead-researcher": {
    feeds: [webSearchFeed(), signalsFeed()],
    produces: ["Real prospect lists (retailers, teams, orgs) with citations"],
  },
  "lead-qualifier": {
    feeds: [signalsFeed()],
    produces: ["HOT/WARM/COLD scoring of researched leads"],
  },
  "outreach-writer": {
    feeds: [signalsFeed()],
    produces: ["First-touch outreach email drafts → your queue (nothing sends itself)"],
  },
  "partner-vetter": {
    feeds: [webSearchFeed(), signalsFeed()],
    produces: ["PURSUE / PASS / WATCH partnership calls with reasoning"],
  },
  "events-scout": {
    feeds: [webSearchFeed(), signalsFeed()],
    produces: ["Grassroots event calendar with booth/sponsor recommendations"],
  },

  // Web
  "web-manager": {
    feeds: [webContextFeed(), webPrFeed()],
    produces: [
      "Exact storefront changes (content edits and features) → one-click PRs a human merges",
    ],
  },

  // Intelligence
  "website-analytics": {
    feeds: [ga4Feed(), signalsFeed()],
    produces: ["Weekday GA4 traffic reports; reviews Vince's competitor sweeps"],
  },
  "competitor-intel": {
    feeds: [signalsFeed(), webSearchFeed()],
    produces: ["Wednesday competitor sweeps (launches, pricing, sponsorships, patents)"],
  },
};

// ---- public API ------------------------------------------------------------

export function getEmployeeWiring(employeeId: string): EmployeeWiring | null {
  if (!getEmployeeById(employeeId)) return null;
  return WIRING[employeeId] ?? { feeds: [], produces: [] };
}

/** Run every feed check for an employee, in parallel, each with a timeout. */
export async function checkEmployeeWiring(
  employeeId: string,
  timeoutMs = 25_000
): Promise<WiringCheckResult[]> {
  const wiring = getEmployeeWiring(employeeId);
  if (!wiring) return [];
  return Promise.all(
    wiring.feeds.map(async (f): Promise<WiringCheckResult> => {
      const started = Date.now();
      const base = { id: f.id, label: f.label, description: f.description, kind: f.kind };
      try {
        const res = await withTimeout(f.check(), timeoutMs);
        const ms = Date.now() - started;
        if (typeof res === "object" && res !== null && "warn" in res) {
          return { ...base, status: "warn", note: res.warn, ms };
        }
        return { ...base, status: "ok", note: res, ms };
      } catch (e) {
        return {
          ...base,
          status: "fail",
          note: e instanceof Error ? e.message : String(e),
          ms: Date.now() - started,
        };
      }
    })
  );
}
