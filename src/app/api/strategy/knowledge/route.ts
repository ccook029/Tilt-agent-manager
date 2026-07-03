// ---------------------------------------------------------------------------
// /api/strategy/knowledge — Sterling's strategist knowledge base.
// GET  → current knowledge doc. PUT → replace it. Owner-only.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { guardAccountingOwner, getCurrentStaff } from "@/lib/os-identity";
import {
  getStrategistKnowledge,
  setStrategistKnowledge,
} from "@/lib/strategist-knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;
  return NextResponse.json({ ok: true, knowledge: await getStrategistKnowledge() });
}

export async function PUT(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  const staff = await getCurrentStaff();
  const doc = await setStrategistKnowledge(content, staff?.name);
  return NextResponse.json({ ok: true, knowledge: doc });
}
