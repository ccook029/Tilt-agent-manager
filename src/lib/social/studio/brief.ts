import { CLAUDE_MODEL } from "@/lib/models";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { BRAND, HARD_RULES, PILLARS, checkContentSafety } from "@/lib/social/brand";

/**
 * The Studio brain. Turns the founder's freeform request ("make me a desktop
 * background") into a tight, on-brand, guardrail-safe brief for the image model:
 * a short title, a creative concept, the treatment brief the model renders, and
 * optional display text. It carries the same brand knowledge as the social brain
 * (voice, colors, hard rules) so anything generated here is unmistakably Tilt.
 *
 * If ANTHROPIC_API_KEY is unset, it degrades gracefully to a minimal brief built
 * straight from the request — so the Studio still works with only a Gemini key.
 */

const StudioBriefSchema = z.object({
  /** Short label for the piece, e.g. "Don't Be A Sheep desktop". */
  title: z.string(),
  /** One or two sentences describing the creative concept. */
  concept: z.string(),
  /**
   * The treatment brief handed to the image model: composition, palette,
   * texture, mood, where to leave clean space for the logo. Describes graphic
   * treatment only — never invents players, sticks, products, or hockey scenes.
   */
  treatmentBrief: z.string(),
  /** Words to render onto the image, or null for a clean/text-free piece. */
  displayText: z.string().nullable(),
});

export type StudioBrief = z.infer<typeof StudioBriefSchema>;

export type ComposedStudioBrief = {
  brief: StudioBrief;
  safety: { safe: boolean; violations: string[] };
  source: "claude" | "fallback";
};

export type StudioRequest = {
  prompt: string;
  width: number;
  height: number;
  /** True when a real catalog photo is the base (a subject is involved). */
  hasBasePhoto: boolean;
  basePhotoDescription?: string | null;
};

function systemPrompt(): string {
  return [
    `You are the brand designer for ${BRAND.name} (a division of ${BRAND.parent}).`,
    `Core line: "${BRAND.coreLine}". Voice: ${BRAND.voice.join(", ")}.`,
    `Themes: ${BRAND.themes.join(" / ")}.`,
    `Brand colors — Black ${BRAND.colors.black}, Cyan ${BRAND.colors.cyan}, Dark Gray ${BRAND.colors.darkGray}, Mid Gray ${BRAND.colors.midGray}.`,
    `Display font feel: ${BRAND.fonts.display} (bold condensed, uppercase). Body: ${BRAND.fonts.body}.`,
    `Content pillars: ${PILLARS.map((p) => p.name).join(", ")}.`,
    ``,
    `You design freeform brand collateral on request — desktop/phone wallpapers, posters, banners, social graphics. Translate the request into a concrete, on-brand design brief.`,
    ``,
    `NON-NEGOTIABLE RULES:`,
    ...HARD_RULES.map((r) => `- ${r}`),
    `- When NO real base photo is supplied, the brief must describe an ABSTRACT / GRAPHIC / TYPOGRAPHIC treatment only — brand colors, geometry, texture, light, the tagline. Never describe or imply generating players, sticks, products, jerseys, logos, crests, or hockey rinks/scenes.`,
    `- When a real base photo IS supplied, the brief edits/treats THAT photo only (color, grade, framing, text) — never adds invented subjects.`,
    `- Always leave clean, uncluttered space in the lower-right for the TILT logo, which is composited by code afterward — do not describe drawing the logo.`,
    `- Keep any display text short and in the brand voice. If the piece reads better clean, set displayText to null.`,
  ].join("\n");
}

function userPrompt(req: StudioRequest): string {
  const aspect = (req.width / req.height).toFixed(2);
  return [
    `Design request: "${req.prompt}"`,
    `Canvas: ${req.width}×${req.height}px (aspect ${aspect}).`,
    req.hasBasePhoto
      ? `A REAL Tilt photo is the base of this piece${req.basePhotoDescription ? `: ${req.basePhotoDescription}` : "."}. Treat/brand that photo — do not invent new subjects.`
      : `No base photo. Produce an abstract/graphic/typographic brand piece (no players, products, or scenes).`,
    `Return: a short title, the concept, the treatment brief, and display text (or null).`,
  ].join("\n");
}

/** Composes the Studio brief. Uses Claude when available; falls back otherwise. */
export async function composeStudioBrief(
  req: StudioRequest,
): Promise<ComposedStudioBrief> {
  if (!process.env.ANTHROPIC_API_KEY) {
    const brief: StudioBrief = {
      title: req.prompt.slice(0, 60),
      concept: `Tilt-branded piece from: ${req.prompt}`,
      treatmentBrief: req.hasBasePhoto
        ? `Treat the provided real Tilt photo on-brand: deep black background, cyan accents, bold condensed type. ${req.prompt}. Leave clean space lower-right for the logo.`
        : `Abstract Tilt brand graphic — black base, cyan energy/geometry, bold condensed type, no players or products. ${req.prompt}. Leave clean space lower-right for the logo.`,
      displayText: null,
    };
    return { brief, safety: checkContentSafety(req.prompt), source: "fallback" };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_BRAIN_MODEL ?? CLAUDE_MODEL;

  const response = await anthropic.messages.parse({
    model,
    max_tokens: 1500,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: systemPrompt(),
        cache_control: { type: "ephemeral" }, // stable prefix — cached across requests
      },
    ],
    messages: [{ role: "user", content: userPrompt(req) }],
    output_config: { format: zodOutputFormat(StudioBriefSchema) },
  });

  const brief = response.parsed_output;
  if (!brief) throw new Error("Studio brain returned no parseable brief.");

  const safety = checkContentSafety(
    `${brief.title} ${brief.concept} ${brief.treatmentBrief} ${brief.displayText ?? ""}`,
  );
  return { brief, safety, source: "claude" };
}
