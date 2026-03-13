// ---------------------------------------------------------------------------
// POST /api/analytics/run — Manual trigger for analytics reports
//
// Body (all optional):
//   {
//     "report_type": "weekly" | "monthly",  // defaults to "weekly"
//     "context": "any extra notes to pass to the agent"
//   }
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { report_type = "weekly", context } = body as {
      report_type?: "weekly" | "monthly";
      context?: string;
    };

    if (report_type === "monthly") {
      // Monthly reports can be added later — for now, return a helpful error
      return NextResponse.json(
        {
          error:
            "Monthly reports are not yet implemented. Use report_type: 'weekly'.",
        },
        { status: 400 }
      );
    }

    // Delegate to the weekly route's POST handler internally
    const baseUrl = request.nextUrl.origin;
    const response = await fetch(`${baseUrl}/api/analytics/weekly`, {
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
      report_type,
      triggered_at: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analytics/run] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
