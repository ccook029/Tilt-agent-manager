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
import { renderRetailersSnapshot } from "../sales/retailers";

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
  const [sheet, sync, inventory] = await Promise.all([
    safeBlock("MASTER ZOHO SHEET (source of truth for stick counts)", fetchSheetSnapshot()),
    safeBlock("SHEET ↔ INVENTORY RECONCILIATION", fetchSyncReport(), 3000),
    safeBlock("ZOHO INVENTORY SNAPSHOT", fetchInventorySnapshot()),
  ]);
  return `\n\n${sheet}\n\n${sync}\n\n${inventory}`;
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

async function renderSalesContext(): Promise<string> {
  const [team, retail] = await Promise.all([
    renderTeamOrdersSnapshot().catch(
      (e) => `(team orders unavailable this run: ${e})`
    ),
    renderRetailersSnapshot().catch(
      (e) => `(retailers unavailable this run: ${e})`
    ),
  ]);
  return [
    "",
    "",
    "=== OPEN TEAM-STORE ORDERS (consolidate and route each line to a vendor) ===",
    team,
    "=== END TEAM ORDERS ===",
    "",
    "=== RETAILER / CONSIGNMENT ACCOUNTS ===",
    retail,
    "=== END RETAILERS ===",
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
        return await renderSalesContext();
      default:
        return "";
    }
  } catch {
    return "";
  }
}
