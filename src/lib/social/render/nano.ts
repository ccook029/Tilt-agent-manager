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

/**
 * Edits a real photo via Nano Banana Pro. Returns PNG/JPEG bytes.
 * Throws if GEMINI_API_KEY is unset or the model returns no image.
 */
export async function nanoEdit(params: {
  sourceImage: Buffer;
  sourceMimeType: string;
  brief: NanoBrief;
}): Promise<{ image: Buffer; mimeType: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set — the static render pipeline needs it.");
  }

  const url = `${API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: guardrailPrompt(params.brief) },
          {
            inline_data: {
              mime_type: params.sourceMimeType || "image/jpeg",
              data: params.sourceImage.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: { responseModalities: ["IMAGE"] },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Nano Banana request failed: ${res.status} ${await res.text()}`);
  }

  type Inline = { mime_type?: string; mimeType?: string; data?: string };
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inline_data?: Inline; inlineData?: Inline }[] } }[];
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
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
