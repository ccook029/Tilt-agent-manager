import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { renderPendingStatics } from "@/lib/social/render/pipeline";

/**
 * Renders pending static posts (render_kind = "nano"): Nano Banana Pro treats
 * the real photo, then code composites the TILT logo. Needs DATABASE_URL,
 * BLOB_READ_WRITE_TOKEN, and GEMINI_API_KEY.
 *
 * Body (optional): { limit?, token? }
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { limit?: number; token?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Preview mode — no database. Add DATABASE_URL, BLOB_READ_WRITE_TOKEN, and GEMINI_API_KEY in Vercel to render.",
      },
      { status: 400 },
    );
  }

  try {
    const results = await renderPendingStatics({ limit: body.limit });
    const rendered = results.filter((r) => r.renderUrl).length;
    return NextResponse.json({ ok: true, rendered, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
