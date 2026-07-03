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

/** Block appended to an agent's system prompt. Empty until Chris adds facts. */
export async function renderOrgKnowledge(): Promise<string> {
  const doc = await getOrgKnowledge().catch(() => null);
  if (!doc?.content?.trim()) return "";
  return [
    "",
    "=== TILT COMPANY KNOWLEDGE (shared across all agents — authoritative) ===",
    "Facts Chris has taught about how Tilt operates. Apply them without asking.",
    "",
    doc.content.trim(),
    "=== END COMPANY KNOWLEDGE ===",
  ].join("\n");
}
