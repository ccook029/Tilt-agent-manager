// GET  /api/daily-brief — today's brief (generates + caches on first hit).
// POST /api/daily-brief — force a regeneration (the panel's Refresh button).
// Auth: OS login middleware gates all app routes.
import { NextResponse } from "next/server";
import { getDailyBrief } from "@/lib/daily-brief";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const brief = await getDailyBrief();
    return NextResponse.json({ ok: true, brief });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const brief = await getDailyBrief(true);
    return NextResponse.json({ ok: true, brief });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
