// ---------------------------------------------------------------------------
// strategist-context.ts — the block appended to Sterling's system prompt that
// turns him from a bookkeeping CFO into Chris's financial analyst & strategist:
// the Tilt Business Strategist knowledge, the live expected-contracts pipeline,
// and the forward revenue projection built from it.
// ---------------------------------------------------------------------------
import { renderStrategistKnowledge } from "./strategist-knowledge";
import { getContracts } from "./expected-contracts";
import { buildProjection, renderProjectionSummary } from "./projections";

export async function buildStrategistContext(): Promise<string> {
  const [knowledge, contracts] = await Promise.all([
    renderStrategistKnowledge().catch(() => ""),
    getContracts().catch(() => []),
  ]);
  const projection = buildProjection(contracts, 12);

  const active = contracts.filter((c) => c.status !== "lost");
  const contractsBlock =
    active.length === 0
      ? "(no expected contracts logged yet — ask Chris to add pipeline deals on the Strategy → Contracts screen)"
      : active
          .map((c) => {
            const rec =
              c.cadence === "one-time"
                ? `$${c.amount.toLocaleString()} one-time`
                : `$${c.amount.toLocaleString()}/${c.cadence === "annual" ? "yr" : "mo"} × ${c.termMonths ?? 12}mo`;
            const conf = c.status === "won" ? "WON" : `${c.probability}%`;
            return `- ${c.name}${c.counterparty ? ` (${c.counterparty})` : ""}: ${rec}, ${conf}, starts ${c.expectedStart}${c.category ? ` [${c.category}]` : ""}${c.notes ? ` — ${c.notes}` : ""}`;
          })
          .join("\n");

  return [
    "",
    "=== YOUR EXPANDED ROLE: TILT FINANCIAL ANALYST & STRATEGIST ===",
    "Beyond keeping the books clean, you are Chris's personal financial analyst",
    "for Tilt Hockey. Discuss strategy, growth, projections, and reporting on",
    "demand. Ground every answer in Tilt's real numbers and the knowledge below.",
    "When Chris asks for growth strategies, be concrete and tie them to the model",
    "and the pipeline. Always distinguish committed vs probability-weighted vs",
    "best-case, and separate revenue recognition from cash timing when it matters.",
    knowledge, // delimited block, or "" until Chris loads his strategist content
    "",
    "=== EXPECTED CONTRACTS PIPELINE (Chris-maintained) ===",
    contractsBlock,
    "",
    "=== REVENUE PROJECTION — next 12 months (from the pipeline above) ===",
    renderProjectionSummary(projection),
    "=== END STRATEGIST CONTEXT ===",
  ].join("\n");
}
