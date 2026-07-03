import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAUDE_MODEL } from "@/lib/models";
import { BRAND, PILLARS } from "./brand";
import type { AssetTags } from "./db/schema";

/**
 * Vision tagging pass (Phase 1).
 *
 * Sends a real photo to Claude vision and asks it to populate the structured
 * `assets.tags` bag + a list of suitable post types. Re-runnable: the sync
 * pipeline only calls this for assets that have not been tagged yet.
 *
 * Note: we tag PHOTOS here. Videos are catalogued with metadata only in Phase 1
 * (frame-extraction tagging is a later enhancement) — see `tagVideoStub`.
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

// Defaults to the hub's central model switch (src/lib/models.ts); the
// ANTHROPIC_VISION_MODEL env var stays as a per-module override.
const VISION_MODEL = process.env.ANTHROPIC_VISION_MODEL ?? CLAUDE_MODEL;

const TagSchema = z.object({
  product: z.string().nullable().optional(),
  person: z.string().nullable().optional(),
  action: z.enum(["action", "static"]).nullable().optional(),
  setting: z.string().nullable().optional(),
  orientation: z.enum(["portrait", "landscape", "square"]).nullable().optional(),
  keywords: z.array(z.string()).optional(),
  description: z.string().nullable().optional(),
  pillars: z.array(z.number().int().min(1).max(6)).optional(),
  suitablePostTypes: z.array(z.string()).optional(),
});

export type TaggingResult = {
  tags: AssetTags;
  suitablePostTypes: string[];
  model: string;
};

const PILLAR_LIST = PILLARS.map((p) => `${p.id}. ${p.name}`).join("\n");

const SYSTEM_PROMPT = `You are the asset cataloguer for ${BRAND.name} (${BRAND.parent}), a player-first, anti-corporate hockey brand ("${BRAND.coreLine}").

You tag REAL photos from the brand's shoot library so a planning agent can match them to social posts. You only describe what is actually in the image — never invent details, never describe imaginary players or product.

The six content pillars are:
${PILLAR_LIST}

Return STRICT JSON matching this shape (no markdown, no commentary):
{
  "product": string|null,        // hockey product visible (e.g. "X1 player stick", "goalie stick", "apparel"), else null
  "person": string|null,         // person/role if identifiable from context (e.g. "player", "goalie", "Prust"), else null
  "action": "action"|"static",   // is the subject mid-action (shooting/skating) or static (posed/product shot)?
  "setting": string|null,        // e.g. "rink", "studio", "locker room", "outdoor"
  "orientation": "portrait"|"landscape"|"square",
  "keywords": string[],          // 3-8 concise visual descriptors
  "description": string,         // one plain-English sentence
  "pillars": number[],           // pillar ids (1-6) this image suits, best first
  "suitablePostTypes": string[]  // e.g. ["reel-cover","static","carousel"]
}`;

/** Tags a single photo from its bytes. */
export async function tagPhoto(params: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<TaggingResult> {
  const mediaType = normalizeMediaType(params.mimeType, params.filename);

  const message = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: params.buffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `Filename: ${params.filename}\nTag this image. Return ONLY the JSON object.`,
          },
        ],
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = TagSchema.parse(extractJson(text));
  const { suitablePostTypes = [], ...tags } = parsed;

  return {
    tags: tags as AssetTags,
    suitablePostTypes,
    model: VISION_MODEL,
  };
}

/**
 * Phase-1 video handling: we don't run vision on video yet, but we still record
 * the asset with best-effort tags derived from its filename (the root player
 * videos are named "PRUST NICHOLS SCHREMP X TILT.mp4" etc.).
 */
export function tagVideoStub(filename: string): TaggingResult {
  const base = filename.replace(/\.[^.]+$/, "");
  const person = base
    .replace(/x\s*tilt/i, "")
    .replace(/[-_]/g, " ")
    .trim();
  return {
    tags: {
      person: person || null,
      action: "action",
      description: `Player video: ${base}`,
      keywords: ["video", "player", "athlete"],
      pillars: [3],
    },
    suitablePostTypes: ["reel", "manual-edit"],
    model: "filename-heuristic",
  };
}

function normalizeMediaType(
  mimeType: string,
  filename: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const m = mimeType.toLowerCase();
  if (m.includes("png")) return "image/png";
  if (m.includes("gif")) return "image/gif";
  if (m.includes("webp")) return "image/webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Tagging model did not return JSON: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}
