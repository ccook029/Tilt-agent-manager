import { BRAND } from "@/lib/social/brand";

/**
 * Nano Banana Pro (Google Gemini image model) client — Phase 3.
 *
 * HARD BRAND RULE: real assets only. We send the brand's REAL photo as the base
 * and ask the model to EDIT/treat/brand/format it — never to invent players,
 * sticks, or scenes. The model may render display text and treatment; the TILT
 * logo is added by code afterward (see overlay.ts).
 *
 * Uses the REST API directly to avoid SDK churn. Model is configurable; default
 * targets the "Nano Banana Pro" image model.
 */

const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image-preview";
const API_BASE =
  process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";

export type NanoBrief = {
  /** The render brief from the brain: treatment + display text. */
  brief: string;
  displayText?: string;
};

function guardrailPrompt(brief: NanoBrief): string {
  return [
    `You are editing a REAL product/athlete photo for ${BRAND.name}.`,
    `Brand colors — Black ${BRAND.colors.black}, Cyan ${BRAND.colors.cyan}, Dark Gray ${BRAND.colors.darkGray}.`,
    `Display font feel: bold condensed (Barlow Condensed).`,
    ``,
    `STRICT RULES:`,
    `- Edit/treat/brand/format the PROVIDED photo only. Do NOT generate or invent new players, sticks, products, logos, or hockey scenes.`,
    `- Do NOT draw or recreate the TILT logo or any team crest — that is added separately by code. Leave clean space in the lower-right for it.`,
    `- Keep the real subject intact and recognizable.`,
    ``,
    `Treatment brief: ${brief.brief}`,
    brief.displayText ? `Display text to render on the image: "${brief.displayText}"` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

async function callImageModel(
  parts: GeminiPart[],
): Promise<{ image: Buffer; mimeType: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set — image generation needs it.");
  }

  const url = `${API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`;
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE"] },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 429 || /RESOURCE_EXHAUSTED/i.test(detail)) {
      throw new Error(
        "Image credits are used up — the Google AI (Gemini) project behind image generation has no prepaid credits left. " +
          "Top up billing at https://aistudio.google.com (Projects → Billing), then hit Redo graphic. " +
          "Partnership graphics don't use image credits; this only affects photo-based designs.",
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "The Gemini API key was rejected — check GEMINI_API_KEY in Vercel project settings.",
      );
    }
    throw new Error(`Nano Banana request failed: ${res.status} ${detail}`);
  }

  type Inline = { mime_type?: string; mimeType?: string; data?: string };
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inline_data?: Inline; inlineData?: Inline }[] } }[];
  };

  const outParts = data.candidates?.[0]?.content?.parts ?? [];
  for (const p of outParts) {
    const inline: Inline | undefined = p.inline_data ?? p.inlineData;
    const b64 = inline?.data;
    if (b64) {
      return {
        image: Buffer.from(b64, "base64"),
        mimeType: inline?.mime_type ?? inline?.mimeType ?? "image/png",
      };
    }
  }
  throw new Error("Nano Banana returned no image in the response.");
}

/**
 * Low-level Nano Banana Pro call with an OPTIONAL source image. Callers own the
 * prompt (and therefore the guardrails): the Studio wraps it for branded graphics
 * with or without a real base photo. Built on the same REST call as nanoEdit.
 */
export async function nanoCall(params: {
  prompt: string;
  sourceImage?: Buffer;
  sourceMimeType?: string;
}): Promise<{ image: Buffer; mimeType: string }> {
  const parts: GeminiPart[] = [{ text: params.prompt }];
  if (params.sourceImage) {
    parts.push({
      inline_data: {
        mime_type: params.sourceMimeType || "image/jpeg",
        data: params.sourceImage.toString("base64"),
      },
    });
  }
  return callImageModel(parts);
}

/**
 * Edits a real photo via Nano Banana Pro. Returns PNG/JPEG bytes.
 * Throws if GEMINI_API_KEY is unset or the model returns no image.
 */
export async function nanoEdit(params: {
  sourceImage: Buffer;
  sourceMimeType: string;
  brief: NanoBrief;
}): Promise<{ image: Buffer; mimeType: string }> {
  return callImageModel([
    { text: guardrailPrompt(params.brief) },
    {
      inline_data: {
        mime_type: params.sourceMimeType || "image/jpeg",
        data: params.sourceImage.toString("base64"),
      },
    },
  ]);
}

/**
 * Generates a pure DESIGN graphic from text only (no source photo) — used for
 * announcement layouts. The same hard rules apply: the prompt must never ask
 * for players, products, scenes, or logos; logos are composited by code.
 */
export async function nanoGenerate(prompt: string): Promise<{ image: Buffer; mimeType: string }> {
  return callImageModel([{ text: prompt }]);
}
