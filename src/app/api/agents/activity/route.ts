// ---------------------------------------------------------------------------
// GET /api/agents/activity?agentId=X — one agent's activity (runs + work orders
// + pending), newest first. Powers the per-agent activity panel on their page.
// Signed-in staff only (the login-wall middleware).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { agentActivityItems, ACCOUNTING_AGENT_IDS } from "@/lib/activity";
import { getCurrentStaff, isAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  // Finance agents' activity carries financial detail — owner only.
  if (ACCOUNTING_AGENT_IDS.has(agentId)) {
    const staff = await getCurrentStaff().catch(() => null);
    if (!isAccountingOwner(staff)) {
      return NextResponse.json({ error: "restricted" }, { status: 403 });
    }
  }
  const items = await agentActivityItems(agentId).catch(() => []);
  return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
}
