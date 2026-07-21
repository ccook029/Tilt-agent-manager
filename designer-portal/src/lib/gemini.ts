// ---------------------------------------------------------------------------
// gemini.ts — Gemini client for the Tilt Design Portal.
//
// Ported from the agent manager's Nano Banana client
// (src/lib/social/render/nano.ts): raw REST against the Generative Language
// API, no SDK. Two modes:
//   - "design": the Nano Banana image model, may return images AND text
//   - "chat":   the fast text model, text only
// The full conversation (including inline images) is sent each call, exactly
// like a normal Gemini chat.
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image-preview";
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";

export type ChatPart =
  | { text: string }
  | { image: { dataUrl: string } };

export type ChatMessage = {
  role: "user" | "model";
  parts: ChatPart[];
};

export type GenerateMode = "design" | "chat";

const ASPECT_RATIOS = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
// Output resolution for the image model. The API defaults to 1K unless asked;
// the Gemini app renders Nano Banana Pro at 2K/4K, so the portal exposes this.
const IMAGE_SIZES = new Set(["1K", "2K", "4K"]);

type WirePart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

function toWirePart(part: ChatPart): WirePart | null {
  if ("text" in part) {
    return part.text ? { text: part.text } : null;
  }
  const match = /^data:([^;]+);base64,(.+)$/.exec(part.image.dataUrl);
  if (!match) return null;
  return { inline_data: { mime_type: match[1], data: match[2] } };
}

export async function generate(params: {
  messages: ChatMessage[];
  mode: GenerateMode;
  aspectRatio?: string;
  imageSize?: string;
}): Promise<ChatPart[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set — ask the site owner to configure it.");
  }

  const contents = params.messages
    .map((m) => ({
      role: m.role,
      parts: m.parts.map(toWirePart).filter((p): p is WirePart => p !== null),
    }))
    .filter((m) => m.parts.length > 0);
  if (contents.length === 0) {
    throw new Error("Nothing to send — write a prompt or attach an image.");
  }

  const model = params.mode === "design" ? IMAGE_MODEL : TEXT_MODEL;
  const generationConfig: Record<string, unknown> = {};
  if (params.mode === "design") {
    generationConfig.responseModalities = ["IMAGE", "TEXT"];
    const imageConfig: Record<string, unknown> = {};
    if (params.aspectRatio && ASPECT_RATIOS.has(params.aspectRatio)) {
      imageConfig.aspectRatio = params.aspectRatio;
    }
    if (params.imageSize && IMAGE_SIZES.has(params.imageSize)) {
      imageConfig.imageSize = params.imageSize;
    }
    if (Object.keys(imageConfig).length > 0) {
      generationConfig.imageConfig = imageConfig;
    }
  }

  const url = `${API_BASE}/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents, generationConfig }),
  });

  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 429 || /RESOURCE_EXHAUSTED/i.test(detail)) {
      throw new Error(
        "Gemini credits are used up — the Google AI project behind this portal has no prepaid credits left. " +
          "Let the site owner know so they can top up billing at https://aistudio.google.com."
      );
    }
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID/i.test(detail)) {
      throw new Error(
        "The Gemini API key was rejected — ask the site owner to check GEMINI_API_KEY in the project settings."
      );
    }
    throw new Error(`Gemini request failed: ${res.status} ${detail.slice(0, 600)}`);
  }

  type Inline = { mime_type?: string; mimeType?: string; data?: string };
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string; inline_data?: Inline; inlineData?: Inline }[] };
      finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
  };

  const outParts: ChatPart[] = [];
  for (const p of data.candidates?.[0]?.content?.parts ?? []) {
    const inline = p.inline_data ?? p.inlineData;
    if (inline?.data) {
      const mime = inline.mime_type ?? inline.mimeType ?? "image/png";
      outParts.push({ image: { dataUrl: `data:${mime};base64,${inline.data}` } });
    } else if (p.text) {
      outParts.push({ text: p.text });
    }
  }

  if (outParts.length === 0) {
    const block = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason;
    throw new Error(
      block
        ? `Gemini returned nothing (${block}). Try rewording the prompt.`
        : "Gemini returned an empty response. Try again or reword the prompt."
    );
  }
  return outParts;
}
