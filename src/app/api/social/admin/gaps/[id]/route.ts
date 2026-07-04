import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { updateGapStatus } from "@/lib/social/queries";

/**
 * Update a gap's status (Phase 5). The founder marks a shot-list item as shot
 * (captured) or dismissed, or reopens it.
 *
 * PATCH body: { status: "open" | "shot" | "dismissed", token? }
 */
const VALID = new Set(["open", "shot", "dismissed"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { status?: string; token?: string } = {};
  try {
    body = (await req.json()) as { status?: string; token?: string };
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  if (!body.status || !VALID.has(body.status)) {
    return NextResponse.json(
      { ok: false, error: "status must be one of: open, shot, dismissed." },
      { status: 400 },
    );
  }

  if (isDemoMode()) {
    return NextResponse.json({ ok: true, demo: true });
  }

  try {
    const gap = await updateGapStatus(id, body.status as "open" | "shot" | "dismissed");
    if (!gap) {
      return NextResponse.json({ ok: false, error: "Gap not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, gap });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
