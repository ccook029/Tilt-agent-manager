// ---------------------------------------------------------------------------
// org/department-context.ts — per-department grounding for the engine
//
// The engine appends whatever a department returns here to BOTH the worker's
// and the boss's system prompts, so a creator drafts and their director
// reviews against the identical brand bar, plan, and intel. Departments
// without a provider return "" and behave exactly as before.
// ---------------------------------------------------------------------------
import type { Employee } from "./types";
import { renderMarketingContext } from "./marketing-context";

/** Roles that plan around performance data get the (pricier) GA4 block. */
const ANALYTICS_ROLES = new Set(["marketing-director", "seo-specialist"]);

export async function renderDepartmentContext(
  employee: Employee
): Promise<string> {
  if (employee.departmentId === "marketing") {
    return renderMarketingContext({
      includeAnalytics: ANALYTICS_ROLES.has(employee.id),
    }).catch(() => "");
  }
  return "";
}
