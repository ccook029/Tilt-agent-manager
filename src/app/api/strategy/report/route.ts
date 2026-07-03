// ---------------------------------------------------------------------------
// POST /api/strategy/report — Sterling writes a financial/strategy report on
// demand: growth strategy, a projection walk-through, or a general briefing.
// Owner-only. Grounded in the strategist knowledge + live pipeline/projection.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { guardAccountingOwner } from "@/lib/os-identity";
import { callClaude } from "@/lib/anthropic";
import { buildStrategistContext } from "@/lib/strategist-context";
import cfoConfig from "@/agents/accounting-manager.config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PRESETS: Record<string, string> = {
  growth:
    "Write a GROWTH STRATEGY memo for Tilt Hockey: 3–5 concrete, prioritized plays to grow revenue, each tied to Tilt's model and the current pipeline, with the rough financial upside, what it costs/needs, and the risk. End with the single highest-leverage move to make this quarter.",
  projection:
    "Write a PROJECTION BRIEFING: walk through the next 12 months of expected revenue (committed vs probability-weighted vs best-case), call out the biggest swing factors in the pipeline, note revenue-recognition vs cash-timing gaps, and flag any month that looks tight.",
  briefing:
    "Write a concise FINANCIAL BRIEFING for Chris: where Tilt stands, what the pipeline implies, the top 3 things to watch, and 2–3 recommended actions.",
};

export async function POST(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const kind = String(body.kind ?? "briefing");
  const custom = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const instruction = custom || PRESETS[kind] || PRESETS.briefing;

  try {
    const res = await callClaude({
      systemPrompt: cfoConfig.systemPrompt + (await buildStrategistContext().catch(() => "")),
      userMessage: `${instruction}\n\nUse markdown with clear headers. Be specific with numbers from the pipeline/projection above. State your assumptions. Today: ${new Date().toISOString().slice(0, 10)}.`,
      model: cfoConfig.model,
      maxTokens: 2560,
      temperature: 0.4,
    });
    return NextResponse.json({ ok: true, report: res.text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Report generation failed." },
      { status: 500 }
    );
  }
}
