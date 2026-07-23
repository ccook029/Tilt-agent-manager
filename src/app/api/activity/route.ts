// ---------------------------------------------------------------------------
// GET /api/activity — the whole company's recent activity (every agent's runs,
// work orders, and in-flight tasks), newest first. Powers the company feed.
// Signed-in staff only (the login-wall middleware).
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { companyActivityItems } from "@/lib/activity";
import { getCurrentStaff, isAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  // The accounting owner sees finance activity in the feed too; other staff
  // see everything else.
  const staff = await getCurrentStaff().catch(() => null);
  const items = await companyActivityItems(isAccountingOwner(staff)).catch(() => []);
  return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
}
