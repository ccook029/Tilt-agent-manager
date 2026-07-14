import { NextResponse } from "next/server";
import { generate, type ChatMessage, type GenerateMode } from "@/lib/gemini";

// Image generation can take a while; match the Studio's ceiling.
export const maxDuration = 300;

const MAX_MESSAGES = 32;

function isChatMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== "object") return false;
  const msg = m as ChatMessage;
  return (
    (msg.role === "user" || msg.role === "model") &&
    Array.isArray(msg.parts) &&
    msg.parts.every(
      (p) =>
        (typeof (p as { text?: unknown }).text === "string" &&
          (p as { text: string }).text.length <= 100_000) ||
        typeof (p as { image?: { dataUrl?: unknown } }).image?.dataUrl === "string"
    )
  );
}

export async function POST(req: Request) {
  let body: { messages?: unknown; mode?: unknown; aspectRatio?: unknown; imageSize?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messages = Array.isArray(body.messages)
    ? body.messages.filter(isChatMessage).slice(-MAX_MESSAGES)
    : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }

  const mode: GenerateMode = body.mode === "chat" ? "chat" : "design";
  const aspectRatio = typeof body.aspectRatio === "string" ? body.aspectRatio : undefined;
  const imageSize = typeof body.imageSize === "string" ? body.imageSize : undefined;

  try {
    const parts = await generate({ messages, mode, aspectRatio, imageSize });
    return NextResponse.json({ parts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
