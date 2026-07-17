// ---------------------------------------------------------------------------
// /api/agents/tts — natural voice for the employee chats.
//
// POST { text, agentId } → audio/wav
//
// Uses Gemini's TTS (same GEMINI_API_KEY that powers the announcement
// renders). Each employee gets a consistent voice picked from a small pool by
// hashing their id, so Harper doesn't sound like Stockton. Gemini returns raw
// 16-bit PCM; we wrap it in a WAV header for the <audio> element. The client
// falls back to browser speech synthesis when this route errors (no key, quota,
// model change).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_BASE =
  process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
const TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";

// A small pool of Gemini prebuilt voices that sound good conversationally.
const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Leda", "Fenrir"];

function voiceFor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return VOICES[hash % VOICES.length];
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
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not set — using the browser voice instead." },
      { status: 501 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    agentId?: string;
  };
  const text = body.text?.trim().slice(0, 2600);
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
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
              prebuiltVoiceConfig: { voiceName: voiceFor(body.agentId ?? "default") },
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
