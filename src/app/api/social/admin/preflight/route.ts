import { NextResponse } from "next/server";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";
import { isDemoMode } from "@/lib/social/demo-data";
import { runPreflight } from "@/lib/social/preflight";

/**
 * Active go-live preflight: exercises each integration (DB, Claude, Blob,
 * WorkDrive auth/folder/download, Gemini) with a cheap real call and reports
 * per-link pass/fail + an actionable detail. Token-gated because it makes real
 * outbound calls.
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { token?: string } = {};
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({
      ok: true,
      demo: true,
      ready: false,
      checks: [
        {
          key: "demo",
          label: "Preview mode",
          ok: false,
          skipped: true,
          detail: "No database connected — add DATABASE_URL (and the other secrets) in Vercel, then run preflight again.",
        },
      ],
    });
  }

  try {
    const { checks, ready } = await runPreflight();
    return NextResponse.json({ ok: true, ready, checks });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
