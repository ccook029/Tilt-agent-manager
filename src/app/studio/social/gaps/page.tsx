import { listGaps } from "@/lib/social/queries";
import type { Gap } from "@/lib/social/db/schema";

export const dynamic = "force-dynamic";

export default async function GapsPage() {
  let gaps: Gap[] = [];
  let error: string | null = null;
  try {
    gaps = await listGaps();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="container">
      <p className="tagline">First-class deliverable</p>
      <h1>Gap Report — Shot List</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        What the plan needed but the library lacks. This is your next shoot list —
        surfaced here and in the weekly email.
      </p>

      {error ? (
        <div className="empty">
          <p>Couldn&apos;t load gaps.</p>
          <p style={{ fontSize: "0.8rem" }}>{error}</p>
        </div>
      ) : gaps.length === 0 ? (
        <div className="empty">
          <p>No open gaps 🎉</p>
          <p>The plan is fully covered by the current library.</p>
        </div>
      ) : (
        <div className="gap-list">
          {gaps.map((g) => (
            <div className="gap-card" key={g.id}>
              <div className="gap-card__week">Week of {formatWeek(g.weekStart)}</div>
              <p className="gap-card__desc">{g.neededAssetDescription}</p>
              <span className="status status--needs_review">{g.status}</span>
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
