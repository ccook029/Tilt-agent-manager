import { NextResponse } from "next/server";
import { syncCatalog } from "@/lib/social/catalog";
import { checkAdminToken, tokenFromRequest } from "@/lib/social/admin-auth";

/**
 * Triggers a catalog sync from the web (the "Sync catalog" buttons on /setup).
 *
 * A full ~182-file pull + tagging pass can take a while; serverless has a
 * timeout, so the UI offers a small test sync (a handful of files) plus a full
 * sync. If the full run is too large for one request, raise `maxDuration` (Pro)
 * or run it in batches with `limit`.
 *
 * Body (all optional): { limit?, retag?, tag?, token? }
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { limit?: number; retag?: boolean; tag?: boolean; token?: string } =
    {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const auth = checkAdminToken(tokenFromRequest(req, body));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  try {
    const summary = await syncCatalog({
      limit: body.limit,
      retag: body.retag ?? false,
      tag: body.tag ?? true,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
