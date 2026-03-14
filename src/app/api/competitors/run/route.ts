// ---------------------------------------------------------------------------
// POST /api/competitors/run — Manual trigger for competitor intel reports
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { context } = body as { context?: string };

    // Delegate to the weekly route
    const baseUrl = request.nextUrl.origin;
    const response = await fetch(`${baseUrl}/api/competitors/weekly`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(result, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      triggered_at: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[competitors/run] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
