// GET  /api/org/wiring/[id]  → static wiring map (feeds + produces), no fetches
// POST /api/org/wiring/[id]  → run every feed's LIVE check and report lights
//
// The per-agent diagnostics behind the Wiring panel on /org/[id]: POST actually
// hits Zoho/GA4/tiltweb/etc. for that employee's pipes and returns proof lines,
// so "is this agent connected to real data?" is a button, not a guess.
import { NextRequest, NextResponse } from "next/server";
import { getEmployeeWiring, checkEmployeeWiring } from "@/lib/org/wiring";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const wiring = getEmployeeWiring(id);
  if (!wiring) return NextResponse.json({ error: "unknown employee" }, { status: 404 });
  return NextResponse.json({
    feeds: wiring.feeds.map((f) => ({
      id: f.id,
      label: f.label,
      description: f.description,
      kind: f.kind,
    })),
    produces: wiring.produces,
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const wiring = getEmployeeWiring(id);
  if (!wiring) return NextResponse.json({ error: "unknown employee" }, { status: 404 });
  const results = await checkEmployeeWiring(id);
  return NextResponse.json({ results, checkedAt: new Date().toISOString() });
}
