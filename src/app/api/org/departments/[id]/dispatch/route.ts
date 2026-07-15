// ---------------------------------------------------------------------------
// POST /api/org/departments/[id]/dispatch — the department boss plans the
// period and dispatches work orders to their team (generic version of the
// marketing "Run week" trigger). Body: { maxPieces?, run? }.
// Auth: Tilt OS middleware.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { runDepartmentDispatch } from "@/lib/org/dispatch";

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      maxPieces?: number;
      run?: boolean;
    };
    const result = await runDepartmentDispatch(id, {
      maxPieces:
        typeof body.maxPieces === "number"
          ? Math.max(1, Math.min(8, body.maxPieces))
          : undefined,
      run: body.run,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[api] org/departments/${id}/dispatch failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
