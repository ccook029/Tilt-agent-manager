// ---------------------------------------------------------------------------
// /api/org/settings — org-wide switches (graduation / auto-ship)
//
// GET  → { autoShip: { marketing: false, ... } }
// POST { departmentId, autoShip: boolean } → toggles graduation for a
//      department (only meaningful for departments with a staffed manager).
// Auth: Tilt OS middleware.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getOrgSettings, setAutoShip } from "@/lib/org/settings";
import { getDepartmentById } from "@/lib/org/directory";

export async function GET() {
  return NextResponse.json(await getOrgSettings());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      departmentId?: string;
      autoShip?: boolean;
    };
    if (!body.departmentId || typeof body.autoShip !== "boolean") {
      return NextResponse.json(
        { error: "departmentId and autoShip (boolean) are required." },
        { status: 400 }
      );
    }
    const dept = getDepartmentById(body.departmentId);
    if (!dept) {
      return NextResponse.json(
        { error: `Unknown department: ${body.departmentId}` },
        { status: 404 }
      );
    }
    if (!dept.managerId) {
      return NextResponse.json(
        {
          error: `${dept.name} has no manager — auto-ship requires a boss review, so this department always stops at your queue.`,
        },
        { status: 409 }
      );
    }
    const settings = await setAutoShip(body.departmentId, body.autoShip);
    return NextResponse.json({ ok: true, ...settings });
  } catch (err) {
    console.error("[api] org/settings POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
