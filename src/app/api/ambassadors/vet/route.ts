// ---------------------------------------------------------------------------
// POST /api/ambassadors/vet — the Ambassador Vetting agent.
//
// Given an ambassador application, Claude researches the applicant's public
// presence (Instagram handle + name + location) with the live web-search tool
// and reports whether they have any affiliation with a competing hockey brand
// or retailer — the disqualifying red flag. It recommends, with evidence and
// citations; a human still makes the final approve/deny call.
//
// Auth: Authorization: Bearer <MODULES_SHARED_KEY> (satellite → HQ). The hub
// middleware already lets this through.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/models";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface VetRequest {
  name?: string;
  instagram?: string;
  location?: string;
  followers?: string;
  experience?: string;
  reason?: string;
}

export type VetRisk = "none" | "low" | "medium" | "high";
export type VetRecommendation = "approve" | "deny" | "review";

interface VetFlag {
  brand: string;
  evidence: string;
  url?: string;
}

interface VetVerdict {
  recommendation: VetRecommendation;
  competitorAffiliation: boolean;
  riskLevel: VetRisk;
  flags: VetFlag[];
  summary: string;
}

const SYSTEM = `You are the Ambassador Vetting agent for Tilt Hockey, a hockey stick brand.
Your job: given an ambassador applicant, research their public online presence and
determine whether they have ANY affiliation, sponsorship, ambassadorship, pro-stock
deal, discount-code partnership, or promotional relationship with a COMPETING hockey
brand or retailer. That is a disqualifying red flag for a Tilt ambassador.

Competitors include (non-exhaustive): Swift Hockey, Soyuz Hockey, Bauer, CCM, Warrior,
True, Sherwood, Winnwell, and any other hockey stick/equipment brand or hockey retailer
that runs its own ambassador/sponsorship program. Playing on a team that happens to be
sponsored by another brand is NOT by itself an affiliation — look for the person
personally promoting, being sponsored by, or repping a competitor (bios like
"@brand ambassador", discount codes, "sponsored by", tagged partnership posts, etc.).

Use the web_search tool to look up the applicant's Instagram handle, their name, and
location. Search for their handle plus terms like "ambassador", "sponsored", "hockey",
and competitor names. Prefer primary evidence (their own bio/posts) and cite URLs.

Be careful and precise. Do not invent affiliations. If you cannot find evidence of a
competitor tie, say so and treat it as clear. Distinguish "found a clear competitor
affiliation" (high risk, deny) from "couldn't verify much" (review) from "looks clean"
(approve).

When done researching, output your verdict as a SINGLE JSON object on the final line,
wrapped EXACTLY between <VERDICT> and </VERDICT> tags, with this shape:
{
  "recommendation": "approve" | "deny" | "review",
  "competitorAffiliation": boolean,
  "riskLevel": "none" | "low" | "medium" | "high",
  "flags": [ { "brand": string, "evidence": string, "url": string } ],
  "summary": string
}
- competitorAffiliation=true and recommendation="deny" when you find a real competitor tie.
- recommendation="review" when evidence is thin or ambiguous (human should eyeball).
- recommendation="approve", riskLevel="none", flags=[] when it looks clean.
- summary: 1-3 sentences a reviewer can read at a glance.`;

function buildPrompt(a: VetRequest): string {
  const ig = (a.instagram || "").replace(/^@/, "").trim();
  return [
    "Vet this Tilt Hockey ambassador applicant:",
    "",
    `Name: ${a.name || "(not provided)"}`,
    `Instagram: ${ig ? "@" + ig + `  (https://www.instagram.com/${ig}/)` : "(not provided)"}`,
    `Location: ${a.location || "(not provided)"}`,
    `Stated following: ${a.followers || "(not provided)"}`,
    `Stated hockey experience: ${a.experience || "(not provided)"}`,
    `Why they want to be a Tilt ambassador: ${a.reason || "(not provided)"}`,
    "",
    "Research their public presence and report whether they have any competing hockey brand/retailer affiliation.",
  ].join("\n");
}

function parseVerdict(text: string): VetVerdict | null {
  const m = text.match(/<VERDICT>([\s\S]*?)<\/VERDICT>/);
  const raw = m ? m[1] : text;
  // Fall back to the last {...} block if the tags are missing.
  const jsonStr = m
    ? raw.trim()
    : (raw.match(/\{[\s\S]*\}/)?.[0] ?? "").trim();
  if (!jsonStr) return null;
  try {
    const v = JSON.parse(jsonStr) as Partial<VetVerdict>;
    const risk: VetRisk = ["none", "low", "medium", "high"].includes(v.riskLevel as string)
      ? (v.riskLevel as VetRisk)
      : "none";
    const rec: VetRecommendation = ["approve", "deny", "review"].includes(v.recommendation as string)
      ? (v.recommendation as VetRecommendation)
      : "review";
    return {
      recommendation: rec,
      competitorAffiliation: Boolean(v.competitorAffiliation),
      riskLevel: risk,
      flags: Array.isArray(v.flags)
        ? v.flags
            .filter((f) => f && typeof f.brand === "string")
            .map((f) => ({ brand: f.brand, evidence: String(f.evidence ?? ""), url: f.url }))
        : [],
      summary: typeof v.summary === "string" ? v.summary : "",
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const key = process.env.MODULES_SHARED_KEY;
  const auth = request.headers.get("authorization");
  if (!key || auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Vetting engine not configured (ANTHROPIC_API_KEY)." },
      { status: 503 }
    );
  }

  let body: VetRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.name && !body.instagram) {
    return NextResponse.json(
      { error: "Need at least a name or Instagram handle to vet." },
      { status: 400 }
    );
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: buildPrompt(body) }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const verdict = parseVerdict(text);
    if (!verdict) {
      return NextResponse.json(
        { error: "Could not parse a verdict from the agent.", raw: text.slice(0, 2000) },
        { status: 502 }
      );
    }

    // Surface a red flag to the HQ feed so it's visible beyond the web admin.
    if (verdict.competitorAffiliation) {
      await postSignal({
        source: "ambassador-vetting",
        headline: `⚠️ Ambassador applicant flagged: ${body.name || body.instagram} — competitor affiliation`,
        detail: verdict.summary,
      });
    }

    return NextResponse.json({ ok: true, verdict });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ambassador-vet] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
