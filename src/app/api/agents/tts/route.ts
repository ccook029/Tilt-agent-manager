// ---------------------------------------------------------------------------
// /api/agents/tts — natural voice for the employee chats.
//
// POST { text, agentId } → audio (wav or mp3)
//
// Provider ladder, best available first:
//   1. ElevenLabs (ELEVENLABS_API_KEY set) — the most human voices.
//   2. Gemini TTS (GEMINI_API_KEY, same key as the announcement renders).
//   3. 501 → the client falls back to the browser voice.
// Each employee gets a consistent voice picked from the provider's pool by
// hashing their id, so Harper doesn't sound like Stockton.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getVoiceMap } from "@/lib/tts-voices";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_BASE =
  process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
const TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";

// A small pool of Gemini prebuilt voices that sound good conversationally.
const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Leda", "Fenrir"];

// ElevenLabs premade voices (id — name): a mix so employees sound distinct.
const ELEVEN_VOICES = [
  "21m00Tcm4TlvDq8ikWAM", // Rachel
  "pNInz6obpgDQGcFmaJgB", // Adam
  "EXAVITQu4vr4xnSDxMaL", // Bella
  "TxGEqnHWrfWFTfGW9XjX", // Josh
  "AZnzlk1XvdvUeBnXmlld", // Domi
  "ErXwobaYiN019PkySvjV", // Antoni
];
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";

function hashPick(agentId: string, pool: string[]): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

async function elevenLabsTts(
  text: string,
  agentId: string,
  key: string,
  voiceIdOverride?: string
): Promise<{ audio: NextResponse } | { error: string }> {
  // Explicit override (the picker's Test button) wins, then a voice Chris
  // assigned on /org/[id] (can be a cloned/premium voice), then the
  // company-wide default, then a stable pick from the premade pool.
  const map = await getVoiceMap().catch(() => ({}) as Record<string, string>);
  const voiceId =
    voiceIdOverride ?? map[agentId] ?? map["default"] ?? hashPick(agentId, ELEVEN_VOICES);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[tts] ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
    return { error: `ElevenLabs ${res.status}: ${detail.slice(0, 200) || "no detail"}` };
  }
  const audio = Buffer.from(await res.arrayBuffer());
  return {
    audio: new NextResponse(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    }),
  };
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    agentId?: string;
    /** Explicit voice to use (the picker's Test button). */
    voiceId?: string;
    /** Fail loudly instead of falling back — surfaces the real provider error. */
    strict?: boolean;
  };
  const text = body.text?.trim().slice(0, 2600);
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const agentId = body.agentId ?? "default";

  // Best voice first: ElevenLabs when its key is configured.
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey && body.strict) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set in Vercel — custom voices aren't linked yet." },
      { status: 501 }
    );
  }
  if (elevenKey) {
    try {
      const result = await elevenLabsTts(text, agentId, elevenKey, body.voiceId);
      if ("audio" in result) return result.audio;
      if (body.strict) {
        return NextResponse.json({ error: result.error }, { status: 502 });
      }
    } catch (err) {
      console.error("[tts] ElevenLabs failed:", err);
      if (body.strict) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "ElevenLabs request failed" },
          { status: 502 }
        );
      }
    }
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "No TTS key set — using the browser voice instead." },
      { status: 501 }
    );
  }

  try {
    const res = await fetch(`${API_BASE}/models/${TTS_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Read this in a natural, warm, conversational voice — like a sharp colleague talking, at a brisk pace: ${text}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: hashPick(agentId, GEMINI_VOICES) },
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[tts] Gemini ${res.status}: ${detail.slice(0, 300)}`);
      return NextResponse.json(
        { error: `TTS unavailable (${res.status})` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
      }[];
    };
    const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inline?.data) {
      return NextResponse.json({ error: "TTS returned no audio" }, { status: 502 });
    }

    const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? 24000);
    const wav = pcmToWav(Buffer.from(inline.data, "base64"), rate);
    return new NextResponse(new Uint8Array(wav), {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[tts] failed:", err);
    return NextResponse.json({ error: "TTS failed" }, { status: 500 });
  }
}
