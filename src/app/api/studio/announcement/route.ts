// ---------------------------------------------------------------------------
// POST /api/studio/announcement — the Design Studio's native Announcement
// Creator. Takes what's being announced and returns ready-to-post copy per
// platform plus a visual brief, in the Tilt voice. Drafts land in the
// signals inbox so the Morning Brief knows an announcement is in flight.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/anthropic";
import { CLAUDE_MODEL } from "@/lib/models";
import { postSignal } from "@/lib/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `You are the announcement writer inside Tilt Hockey's Design Studio.

Tilt Hockey is an aggressive, innovative hockey brand: hardgoods (sticks, skate components, accessories) and soft goods / merch (blankets, apparel, fan gear). The voice is confident, athletic, and direct — zero corporate buzzwords, no exclamation-point spam, no hashtag walls.

HARD RULES:
- Never mention internal costs, margins, wholesale pricing, or supplier names.
- Never invent facts (dates, prices, specs) that weren't provided — leave a [FILL IN] placeholder instead.
- Keep every piece ready to paste: no meta-commentary inside the copy blocks.

Output in markdown with these sections:
# <a punchy internal title for this announcement>
## Instagram
Caption (hook first line), then 3-6 relevant hashtags on the last line.
## Facebook
Slightly longer, link-friendly.
## TikTok
Caption + a one-line video concept.
## Visual brief
2-4 bullets for the designer: composition, colors (Tilt Blue #00d6ff on black is home base), type treatment, and which real asset or render to use.
## Timing & rollout
1-3 bullets: suggested order and timing of posts.`;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim() : "general";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!topic) {
    return NextResponse.json(
      { error: "Tell me what we're announcing." },
      { status: 400 }
    );
  }

  try {
    const res = await callClaude({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `Announcement type: ${kind}

What we're announcing:
${topic}
${notes ? `\nExtra context / constraints:\n${notes}` : ""}`,
      model: CLAUDE_MODEL,
      maxTokens: 2000,
    });

    await postSignal({
      source: "design-studio",
      headline: `Announcement drafted: ${topic.slice(0, 140)}`,
    }).catch(() => {});

    return NextResponse.json({ ok: true, text: res.text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed." },
      { status: 500 }
    );
  }
}
