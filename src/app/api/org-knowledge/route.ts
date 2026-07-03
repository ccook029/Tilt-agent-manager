// ---------------------------------------------------------------------------
// /api/org-knowledge — the shared company knowledge every agent reads.
//   GET → current doc (any signed-in staff may read it).
//   PUT → replace it (accounting owner only — "Chris teaches the company once").
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { guardAccountingOwner, getCurrentStaff } from "@/lib/os-identity";
import { getOrgKnowledge, setOrgKnowledge } from "@/lib/org-knowledge";

export const dynamic = "force-dynamic";

export async function GET() {
  // Behind the login wall via middleware; readable by all signed-in staff.
  const knowledge = await getOrgKnowledge().catch(() => null);
  return NextResponse.json({ ok: true, knowledge });
}

export async function PUT(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  const staff = await getCurrentStaff();
  const doc = await setOrgKnowledge(content, staff?.name);
  return NextResponse.json({ ok: true, knowledge: doc });
}
