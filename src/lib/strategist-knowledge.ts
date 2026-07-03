// ---------------------------------------------------------------------------
// strategist-knowledge.ts — Sterling's "Tilt Business Strategist" brain.
//
// A single editable knowledge document (the export of Chris's Tilt Business
// Strategist Claude project: business model, unit economics, growth theses,
// historical context, how Tilt makes money). It's injected into Sterling's
// chat so he reasons as Tilt's financial analyst — not a generic CFO.
//
// Stored in KV so Chris can edit it from the Strategy → Knowledge screen with
// no redeploy. Capped to keep prompt size sane.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "strategist-knowledge";
const MAX_CHARS = 60_000; // generous; ~15k tokens of grounding

export interface StrategistKnowledge {
  content: string;
  updatedAt: string;
  updatedBy?: string;
}

export async function getStrategistKnowledge(): Promise<StrategistKnowledge | null> {
  return (await kv.get<StrategistKnowledge>(KEY)) ?? null;
}

export async function setStrategistKnowledge(
  content: string,
  updatedBy?: string
): Promise<StrategistKnowledge> {
  const doc: StrategistKnowledge = {
    content: content.slice(0, MAX_CHARS),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await kv.set(KEY, doc);
  return doc;
}

/** Formatted for injection into Sterling's system prompt. Empty string when
 * unset, so the chat still works before Chris loads his strategist content. */
export async function renderStrategistKnowledge(): Promise<string> {
  const doc = await getStrategistKnowledge().catch(() => null);
  if (!doc?.content?.trim()) return "";
  return [
    "",
    "=== TILT BUSINESS STRATEGIST KNOWLEDGE (Chris's, authoritative) ===",
    "Reason with this as your grounding on how Tilt operates, makes money, and",
    "should grow. It reflects Chris's own strategy work — treat it as fact about",
    "the business unless newer data contradicts it.",
    "",
    doc.content.trim(),
    "=== END STRATEGIST KNOWLEDGE ===",
  ].join("\n");
}
