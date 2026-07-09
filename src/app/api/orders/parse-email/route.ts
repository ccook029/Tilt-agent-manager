// ---------------------------------------------------------------------------
// POST /api/orders/parse-email — interpret a pasted team/customer email into
// structured custom-stick order lines. Called by the tiltweb admin's "Bulk add
// from email" (Bearer MODULES_SHARED_KEY; the hub holds the Claude key).
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ParseRequest {
  emailText?: string;
  defaults?: {
    teamName?: string;
    baseColor?: string;
    decalColor?: string;
    level?: string;
    size?: string;
  };
}

export interface ParsedLine {
  kind: "player" | "goalie";
  level: string;
  size: string;
  flex: string;
  curve: string;
  kick: string;
  hand: string;
  baseColor: string;
  decalColor: string;
  playerName: string;
  playerNumber: string;
  qty: number;
}

const SYSTEM = `You interpret hockey stick order emails for Tilt Hockey and output ONLY JSON — no markdown, no backticks.

Tilt spec space:
- Levels: Junior (48-58", flex 15-50), Intermediate (58-63", flex 40-65), Senior (64-72", flex 65-110). Goalie sticks use paddle sizes 21-27".
- Flex must be a 5-increment value — snap (e.g. 77 → 75) and note it in warnings.
- Tilt curves: T92, T28, T88, T91A, T90, T02. Emails often use Bauer/CCM names — map them: P92→T92, P29→T92 (CCM P29 = P92 equivalent), P28→T28, P88→T88, P90→T90. Note every mapping in warnings.
- Hand: Left | Right (L/R). Kick: Low | Mid | High (default Mid if unstated).
- If the email gives no length/size, infer the level from flex (65+ = Senior, 40-60 = Intermediate, below = Junior) and use the level's most common length (Senior 66", Intermediate 62", Junior 54") — and add a warning that lengths were assumed.

Apply the caller-provided defaults (team colors etc.) to every line unless the email overrides them. "Two of each of the following" style quantity headers apply to all lines under that header.

Output schema:
{"lines":[{"kind":"player"|"goalie","level":string,"size":string,"flex":string,"curve":string,"kick":string,"hand":"Left"|"Right","baseColor":string,"decalColor":string,"playerName":string,"playerNumber":string,"qty":number}],"teamName":string,"warnings":[string]}
- size: player length like "66\\"" or goalie paddle like "24\\"".
- playerNumber: "" when not given.
- warnings: every assumption, mapping, snap, and anything ambiguous a human should confirm.
Never invent players or quantities not in the email.`;

export async function POST(request: NextRequest) {
  const key = process.env.MODULES_SHARED_KEY;
  const auth = request.headers.get("authorization");
  if (!key || auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ParseRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const emailText = body.emailText?.trim();
  if (!emailText) {
    return NextResponse.json({ error: "Paste the email text." }, { status: 400 });
  }

  try {
    const res = await callClaude({
      systemPrompt: SYSTEM,
      userMessage: `Defaults to apply to every line unless overridden: ${JSON.stringify(body.defaults ?? {})}

## The email
${emailText.slice(0, 8000)}

Parse it into order lines now.`,
      maxTokens: 3000,
      temperature: 0,
    });
    const raw = res.text.replace(/```json|```/g, "").trim();
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    const parsed = JSON.parse(jsonStr) as {
      lines?: ParsedLine[];
      teamName?: string;
      warnings?: string[];
    };
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      return NextResponse.json(
        { error: "Couldn't find any order lines in that email." },
        { status: 422 }
      );
    }
    return NextResponse.json({
      ok: true,
      lines: parsed.lines.slice(0, 100),
      teamName: parsed.teamName ?? body.defaults?.teamName ?? "",
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Parse failed: ${message}` }, { status: 500 });
  }
}
