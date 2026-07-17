// ---------------------------------------------------------------------------
// org/department-context.ts — per-department grounding for the engine
//
// The engine appends whatever a department returns here to BOTH the worker's
// and the boss's system prompts, so an employee drafts and their reviewer
// judges against the identical live data. Every provider is best-effort:
// a missing integration degrades to a note, never an error.
//
//   marketing    → brand bar, content plan/gaps, asset library, intel, GA4+GSC
//   operations   → Zoho master Sheet, Sheet↔Inventory sync, Inventory snapshot
//   product      → recent R&D/product/competitor findings (run logs)
//   intelligence → GA4 week snapshot + recent cross-team signals
//   finance      → (bespoke loop; not engine-run yet)
// ---------------------------------------------------------------------------
import type { Employee } from "./types";
import { renderMarketingContext } from "./marketing-context";
import { fetchInventorySnapshot } from "../zoho";
import { fetchSheetSnapshot } from "../zoho-sheet";
import { fetchSyncReport } from "../zoho-sync";
import { fetchGA4Data, getWeekRange } from "../ga4";
import { getRunLogsByAgent } from "../store";
import { getRecentSignals } from "../signals";
import { renderTeamOrdersSnapshot } from "../sales/team-orders";
import { renderConsignmentSnapshot } from "../sales/retailers";
import { renderRecentInvoicesSnapshot } from "../sales/invoices";
import { fetchBooksSnapshot } from "../zoho-books";
import { renderShipmentsSnapshot } from "../supply/shipments";
import { getOwnerQueue } from "./work-orders";

/** Roles that plan around performance data get the (pricier) GA4 block. */
const ANALYTICS_ROLES = new Set(["marketing-director", "seo-specialist"]);

function safeBlock(
  label: string,
  p: Promise<string>,
  maxChars = 5000
): Promise<string> {
  return p
    .then((s) => `=== ${label} ===\n${s.slice(0, maxChars)}\n=== END ===`)
    .catch(
      (e) =>
        `=== ${label} ===\n(unavailable this run: ${e instanceof Error ? e.message : e})\n=== END ===`
    );
}

/** The freshest report per agent, from the shared run-log store. */
async function latestFindings(
  agentIds: string[],
  perAgentChars = 3500
): Promise<string> {
  const blocks: string[] = [];
  for (const id of agentIds) {
    const logs = await getRunLogsByAgent(id).catch(() => []);
    const latest = logs.find((l) => l.status === "success");
    if (latest) {
      blocks.push(
        `### ${latest.agentName} — ${latest.startedAt.slice(0, 10)}\n${latest.output.slice(0, perAgentChars)}`
      );
    }
  }
  return blocks.length > 0
    ? blocks.join("\n\n---\n\n")
    : "(no recent findings on file)";
}

async function renderOperationsContext(): Promise<string> {
  const [sheet, sync, inventory, shipments] = await Promise.all([
    safeBlock("MASTER ZOHO SHEET (source of truth for stick counts)", fetchSheetSnapshot()),
    safeBlock("SHEET ↔ INVENTORY RECONCILIATION", fetchSyncReport(), 3000),
    safeBlock("ZOHO INVENTORY SNAPSHOT", fetchInventorySnapshot()),
    renderShipmentsSnapshot().catch(() => "(shipment register unavailable this run)"),
  ]);
  return `\n\n${sheet}\n\n${sync}\n\n${inventory}\n\n=== OPEN SHIPMENTS (track each against its timeline; flag at-risk/overdue) ===\n${shipments}\n=== END SHIPMENTS ===`;
}

async function renderProductContext(): Promise<string> {
  const findings = await latestFindings([
    "materials-rd",
    "product-design",
    "competitor-intel",
  ]);
  return [
    "",
    "",
    "=== LATEST R&D / PRODUCT / COMPETITOR FINDINGS (your team's shared knowledge) ===",
    findings,
    "=== END FINDINGS ===",
  ].join("\n");
}

async function renderIntelligenceContext(): Promise<string> {
  const ga4 = await fetchGA4Data(getWeekRange(new Date())).catch(
    () => "(GA4 not available this run.)"
  );
  const signals = await getRecentSignals(24 * 7).catch(() => []);
  const signalBlock =
    signals.length === 0
      ? "(quiet week)"
      : signals
          .slice(0, 15)
          .map((s) => `- [${s.source}] ${s.headline}`)
          .join("\n");
  return [
    "",
    "",
    "=== TILTHOCKEY.COM — LAST 7 DAYS (GA4) ===",
    ga4.slice(0, 4000),
    "=== END GA4 ===",
    "",
    "=== WHAT THE COMPANY DID THIS WEEK (signals) ===",
    signalBlock,
    "=== END SIGNALS ===",
  ].join("\n");
}

async function renderSalesContext(employeeId: string): Promise<string> {
  const teamBlock = async () => {
    const team = await renderTeamOrdersSnapshot().catch(
      (e) => `(team orders unavailable this run: ${e})`
    );
    return [
      "",
      "",
      "=== OPEN TEAM-STORE ORDERS (consolidate and route each line to a vendor) ===",
      team,
      "=== END TEAM ORDERS ===",
    ].join("\n");
  };

  // The auditor cross-references billable consignment months against the real
  // Zoho invoices to find months that were never invoiced.
  const consignmentBlock = async () => {
    const [consign, invoices] = await Promise.all([
      renderConsignmentSnapshot().catch((e) => `(consignment unavailable: ${e})`),
      renderRecentInvoicesSnapshot().catch((e) => `(invoices unavailable: ${e})`),
    ]);
    return [
      "",
      "",
      "=== CONSIGNMENT — BILLABLE MONTHS (what SHOULD be invoiced) ===",
      consign,
      "=== END BILLABLE MONTHS ===",
      "",
      "=== ZOHO BOOKS — RECENT INVOICES (what WAS invoiced; match by retailer + amount + month) ===",
      invoices,
      "=== END INVOICES ===",
    ].join("\n");
  };

  // Auditor → consignment only; coordinator → team orders only; the manager
  // (planning a dispatch) sees both so she can hand out the right work.
  if (employeeId === "retailer-auditor") return await consignmentBlock();
  if (employeeId === "team-sales-coordinator") return await teamBlock();
  return (await teamBlock()) + (await consignmentBlock());
}

async function renderBizdevContext(): Promise<string> {
  const signals = await getRecentSignals(24 * 7).catch(() => []);
  const signalBlock =
    signals.length === 0
      ? "(quiet week)"
      : signals
          .slice(0, 12)
          .map((s) => `- [${s.source}] ${s.headline}`)
          .join("\n");
  return [
    "",
    "",
    "=== PROSPECTING SCOPE ===",
    "Target Tilt's grassroots path in order: Ontario independents → skeptical independent retailers → Source for Sports stores (each buys autonomously — no national order to win) → US starting in Detroit; plus teams and organizations. Do NOT prospect accounts that are already Tilt dealers (see Staff Tools → Retailers); flag any you're unsure about.",
    "=== END SCOPE ===",
    "",
    "=== WHAT TILT DID THIS WEEK (timely hooks for outreach) ===",
    signalBlock,
    "=== END SIGNALS ===",
  ].join("\n");
}

async function renderFinanceContext(): Promise<string> {
  return safeBlock("ZOHO BOOKS SNAPSHOT (cash, A/R, A/P — the live books)", fetchBooksSnapshot());
}

async function renderCxContext(): Promise<string> {
  const signals = await getRecentSignals(24 * 7).catch(() => []);
  const signalBlock =
    signals.length === 0
      ? "(quiet week)"
      : signals.slice(0, 8).map((s) => `- [${s.source}] ${s.headline}`).join("\n");
  return [
    "",
    "",
    "=== TILT WARRANTY POLICY (decide against this) ===",
    "Manufacturer defects are covered (blade delamination, shaft cracks not from impact, factory faults). Normal wear, impact damage, and misuse are NOT covered. A new retailer may swap up to 3 defective sticks per calendar month. When a claim is genuinely a defect, be generous and fast — a well-handled claim makes a player for life. When it's wear or misuse, decline kindly and clearly.",
    "=== END WARRANTY POLICY ===",
    "",
    "=== WHAT THE COMPANY DID THIS WEEK (context for replies) ===",
    signalBlock,
    "=== END SIGNALS ===",
    "",
    "(Live warranty-claim feed from tiltweb is not wired yet — work from the claim in the brief.)",
  ].join("\n");
}

async function renderExecutiveContext(): Promise<string> {
  const [signals, queue] = await Promise.all([
    getRecentSignals(24 * 7).catch(() => []),
    getOwnerQueue().catch(() => []),
  ]);
  const signalBlock =
    signals.length === 0
      ? "(quiet week)"
      : signals.slice(0, 30).map((s) => `- [${s.source}] ${s.headline}`).join("\n");

  const approved = queue.filter((o) => o.status === "approved");
  const escalated = queue.filter((o) => o.status === "escalated");
  const queueBlock =
    queue.length === 0
      ? "(nothing waiting on the founders right now)"
      : [
          `${approved.length} boss-approved and waiting to ship:`,
          ...approved.slice(0, 20).map((o) => `  - [${o.departmentId}] ${o.title}`),
          `${escalated.length} escalated — needs a founder decision:`,
          ...escalated.slice(0, 20).map((o) => `  - [${o.departmentId}] ${o.title}`),
        ].join("\n");

  return [
    "",
    "",
    "=== THE FOUNDERS' QUEUE (what's waiting on Chris & Jeremy right now) ===",
    queueBlock,
    "=== END QUEUE ===",
    "",
    "=== COMPANY ACTIVITY — LAST 7 DAYS (every department's signals) ===",
    signalBlock,
    "=== END ACTIVITY ===",
  ].join("\n");
}

export async function renderDepartmentContext(
  employee: Employee
): Promise<string> {
  try {
    switch (employee.departmentId) {
      case "marketing":
        return await renderMarketingContext({
          includeAnalytics: ANALYTICS_ROLES.has(employee.id),
        });
      case "operations":
        return await renderOperationsContext();
      case "product":
        return await renderProductContext();
      case "intelligence":
        return await renderIntelligenceContext();
      case "sales":
        return await renderSalesContext(employee.id);
      case "bizdev":
        return await renderBizdevContext();
      case "finance":
        return await renderFinanceContext();
      case "cx":
        return await renderCxContext();
      case "executive":
        return await renderExecutiveContext();
      default:
        return "";
    }
  } catch {
    return "";
  }
}
