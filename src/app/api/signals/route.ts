// ---------------------------------------------------------------------------
// /api/signals — the Tilt OS event inbox for satellite tools.
//
// POST { source, headline, detail? } with Authorization: Bearer <MODULES_SHARED_KEY>
//   → satellite tools (Social Studio, Web Admin, Catalog Agent) push one-line
//     updates that land in the Morning Brief and dashboard. One curl:
//
//   curl -X POST https://<hq>/api/signals \
//     -H "Authorization: Bearer $MODULES_SHARED_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"source":"social-studio","headline":"3 posts scheduled this week"}'
//
// GET → recent signals (last 26h) for the dashboard/brief.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { postSignal, getRecentSignals } from "@/lib/signals";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: true, signals: await getRecentSignals() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const key = process.env.MODULES_SHARED_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Signals inbox not enabled — set MODULES_SHARED_KEY in Vercel." },
      { status: 503 }
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { source, headline, detail } = body as {
    source?: string;
    headline?: string;
    detail?: string;
  };
  if (!source?.trim() || !headline?.trim()) {
    return NextResponse.json(
      { error: "source and headline are required" },
      { status: 400 }
    );
  }

  await postSignal({
    source: source.trim().slice(0, 40),
    headline: headline.trim().slice(0, 200),
    detail: detail?.trim().slice(0, 1000),
  });
  return NextResponse.json({ ok: true });
}
