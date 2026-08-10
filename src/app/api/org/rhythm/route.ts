// GET  /api/org/rhythm — the company's standing schedule + on/off state
// POST /api/org/rhythm { id, on } — toggle a rhythm job
import { NextRequest, NextResponse } from "next/server";
import { RHYTHM_JOBS, getRhythmSettings, setRhythmSetting } from "@/lib/org/rhythm";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getRhythmSettings();
  return NextResponse.json({
    jobs: RHYTHM_JOBS.map((j) => ({
      id: j.id,
      label: j.label,
      schedule: j.schedule,
      description: j.description,
      on: settings[j.id] !== false,
    })),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id, on } = body as { id?: string; on?: boolean };
  if (!id || typeof on !== "boolean" || !RHYTHM_JOBS.some((j) => j.id === id)) {
    return NextResponse.json({ error: "expected { id, on }" }, { status: 400 });
  }
  await setRhythmSetting(id, on);
  return NextResponse.json({ ok: true });
}
