import { getSkeleton } from "@/lib/social/queries";
import type { SkeletonWeek } from "@/lib/social/planner/schedule";

export const dynamic = "force-dynamic";

const PILLAR_LABEL: Record<string, string> = {
  proof: "Proof",
  sheep: "Sheep",
  athletes: "Athletes",
  product: "Product",
  community: "Community",
  fit: "Fit",
};

export default async function PlanPage() {
  let weeks: SkeletonWeek[] = [];
  let error: string | null = null;
  try {
    weeks = (await getSkeleton(26)).weeks;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="container">
      <p className="tagline">Living plan · rolling 6 months</p>
      <h1>Content Plan</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        The skeleton: weekly pillar allocations + pinned events. The first two
        weeks are the <strong style={{ color: "var(--tilt-cyan)" }}>locked
        window</strong> — fully written on the Posts page. Everything after stays
        loose and rolls forward.
      </p>

      {error ? (
        <div className="empty">
          <p>Couldn&apos;t load the plan.</p>
          <p style={{ fontSize: "0.8rem" }}>{error}</p>
        </div>
      ) : (
        <div className="week-list">
          {weeks.map((wk, i) => (
            <div className={`week-row${i < 2 ? " week-row--locked" : ""}`} key={wk.weekStart}>
              <div className="week-row__date">
                <div className="week-row__label">{i < 2 ? "Locked" : `Week ${i + 1}`}</div>
                <div className="week-row__start">{formatWeek(wk.weekStart)}</div>
              </div>
              <div className="week-row__body">
                <div className="tags">
                  {Object.entries(wk.pillarAllocations).map(([key, count]) => (
                    <span key={key} className="chip cyan">
                      {(PILLAR_LABEL[key] ?? key)} ×{count}
                    </span>
                  ))}
                </div>
                {wk.pinnedEvents.length > 0 && (
                  <div className="week-row__events">
                    {wk.pinnedEvents.map((e, j) => (
                      <span key={j} className="pinned">
                        📌 {e.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
