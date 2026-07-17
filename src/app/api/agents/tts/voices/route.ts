// ---------------------------------------------------------------------------
// /api/agents/tts/voices — the ElevenLabs voice roster + per-employee picks.
//
// GET               → { voices: [{id, name, category}], map: {agentId: voiceId} }
// POST {agentId, voiceId} → save a pick (voiceId: null clears back to auto)
//
// 501 without ELEVENLABS_API_KEY so the picker simply hides.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getVoiceMap, setVoice } from "@/lib/tts-voices";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ElevenLabs not configured" }, { status: 501 });
  }
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `ElevenLabs voices failed (${res.status})` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      voices?: { voice_id: string; name: string; category?: string }[];
    };
    const voices = (data.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category ?? "",
    }));
    const map = await getVoiceMap().catch(() => ({}));
    return NextResponse.json({ ok: true, voices, map });
  } catch (err) {
    console.error("[tts/voices] failed:", err);
    return NextResponse.json({ error: "Failed to load voices" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    agentId?: string;
    voiceId?: string | null;
  };
  if (!body.agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  const map = await setVoice(body.agentId, body.voiceId ?? null);
  return NextResponse.json({ ok: true, map });
}
