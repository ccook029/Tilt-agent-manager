// ---------------------------------------------------------------------------
// org-knowledge.ts — the company brain every agent shares (audit item #10).
//
// One editable document of Tilt facts Chris teaches ONCE — "Jeremy Elliott is
// a co-founder", "Remitly transfers = Pakistan apparel vendors", "we're
// cash-basis on payables", brand/voice rules, who's who — and every agent
// (Sterling, Penny, Stockton, Dana, …) reads it in both its scheduled runs and
// its chats. No more teaching the same fact to each agent separately.
//
// Stored in KV, editable from the Company Knowledge screen with no redeploy.
// renderOrgKnowledge() returns "" until Chris adds anything, so appending it to
// any system prompt is always safe.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import { renderEthos } from "./ethos";

const KEY = "org-knowledge";
const MAX_CHARS = 40_000;

export interface OrgKnowledge {
  content: string;
  updatedAt: string;
  updatedBy?: string;
}

export async function getOrgKnowledge(): Promise<OrgKnowledge | null> {
  return (await kv.get<OrgKnowledge>(KEY)) ?? null;
}

export async function setOrgKnowledge(
  content: string,
  updatedBy?: string
): Promise<OrgKnowledge> {
  const doc: OrgKnowledge = {
    content: content.slice(0, MAX_CHARS),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await kv.set(KEY, doc);
  return doc;
}

/**
 * The shared company context appended to EVERY employee's system prompt.
 *
 * Two layers, always in this order:
 *   1. THE TILT ETHOS — foundational reasoning, always present (baked in code
 *      so it can never be forgotten or emptied).
 *   2. COMPANY KNOWLEDGE — the specific facts Chris teaches on the /knowledge
 *      screen, layered on top when present.
 *
 * This is the single choke point that makes every employee — worker and boss,
 * new department engine and legacy pipeline — think the Tilt way.
 */
export async function renderOrgKnowledge(): Promise<string> {
  const doc = await getOrgKnowledge().catch(() => null);
  const knowledge = doc?.content?.trim();
  const knowledgeBlock = knowledge
    ? [
        "",
        "=== TILT COMPANY KNOWLEDGE (specific facts Chris has taught — authoritative) ===",
        "Apply these without asking.",
        "",
        knowledge,
        "=== END COMPANY KNOWLEDGE ===",
      ].join("\n")
    : "";
  return renderEthos() + knowledgeBlock;
}
