// POST /api/inventory/order-builder/steer — plain-language steering for the
// Order Builder. Runs on the hub's server-side ANTHROPIC_API_KEY (no browser
// keys), turns an instruction like "skew heavy SR, lower flex, keep variety"
// into the allocator's constraint JSON.
import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/anthropic";
import { DEFAULT_CONSTRAINTS, type Constraints } from "@/lib/order-builder/allocator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SteerBody {
  message?: string;
  constraints?: Constraints;
  demandByLevel?: Record<string, number>;
  history?: { role: "user" | "assistant"; content: string }[];
}

const SYSTEM = `You steer a hockey stick purchase-order allocator for Tilt Hockey. Respond ONLY with JSON, no markdown, no backticks.
Schema: {"level_mix":{"Senior":0-1,"Intermediate":0-1,"Junior":0-1}|null,"flex_bias":"low"|"high"|null,"flex_bias_strength":0-1,"variety":"low"|"medium"|"high","curve_exclude":[strings],"curve_include":[strings]|null,"hand_mix":{"Left":0-1,"Right":0-1}|null,"stock_awareness":0-1,"goalie_share":0-0.3,"reply":"1-2 sentence plain-language confirmation of what you changed and why"}
Valid curves: T92,T28,T88,T91A,T90,T02. Flex ranges: JR 15-50, INT 40-65, SR 65-110 (5-flex increments).
Rules: level_mix must sum to ~1 (it covers player sticks only; goalie_share is carved off the total first). Only change fields the user's instruction implies; carry forward the rest from current constraints. "variety" = how many distinct flex/curve combos per size. "stock_awareness" 1 = weight heavily toward thin-stock SKUs, 0 = pure demand. "goalie_share" is the fraction of the whole order that is goalie sticks (mention it in reply only if the user asked about goalies).
Industry context you may apply when the user invokes trends: senior sticks with mid-to-low flex (75-85) dominate adult retail; T92-style mid curves are the volume leaders; junior demand concentrates at 50/50 flex-size pairings.`;

function sanitizeConstraints(raw: unknown, fallback: Constraints): Constraints {
  const c = (raw ?? {}) as Partial<Constraints>;
  const num = (v: unknown, d: number, lo = 0, hi = 1) =>
    typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    level_mix:
      c.level_mix && typeof c.level_mix === "object" ? c.level_mix : c.level_mix === null ? null : fallback.level_mix,
    flex_bias: c.flex_bias === "low" || c.flex_bias === "high" ? c.flex_bias : c.flex_bias === null ? null : fallback.flex_bias,
    flex_bias_strength: num(c.flex_bias_strength, fallback.flex_bias_strength),
    variety: c.variety === "low" || c.variety === "medium" || c.variety === "high" ? c.variety : fallback.variety,
    curve_exclude: Array.isArray(c.curve_exclude) ? c.curve_exclude.map(String) : fallback.curve_exclude,
    curve_include: Array.isArray(c.curve_include) ? c.curve_include.map(String) : c.curve_include === null ? null : fallback.curve_include,
    hand_mix: c.hand_mix && typeof c.hand_mix === "object" ? c.hand_mix : c.hand_mix === null ? null : fallback.hand_mix,
    stock_awareness: num(c.stock_awareness, fallback.stock_awareness),
    goalie_share: num(c.goalie_share, fallback.goalie_share, 0, 0.3),
  };
}

export async function POST(request: NextRequest) {
  let body: SteerBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Say how to shape the order." }, { status: 400 });
  }
  const current = sanitizeConstraints(body.constraints, DEFAULT_CONSTRAINTS);

  const history = (body.history ?? [])
    .slice(-10)
    .map((h) => `${h.role === "user" ? "User" : "You"}: ${h.content}`)
    .join("\n");

  try {
    const res = await callClaude({
      systemPrompt: SYSTEM,
      userMessage: [
        `Current constraints: ${JSON.stringify(current)}`,
        `Demand by level (lifetime units): ${JSON.stringify(body.demandByLevel ?? {})}`,
        history ? `Recent steering conversation:\n${history}` : "",
        `Instruction: ${message}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 600,
      temperature: 0.2,
    });

    const raw = res.text.replace(/```json|```/g, "").trim();
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    const parsed = JSON.parse(jsonStr) as Partial<Constraints> & { reply?: string };
    const next = sanitizeConstraints(parsed, current);
    return NextResponse.json({
      ok: true,
      constraints: next,
      reply: typeof parsed.reply === "string" ? parsed.reply : "Constraints updated.",
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: messageText }, { status: 502 });
  }
}
