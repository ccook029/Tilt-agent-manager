// ---------------------------------------------------------------------------
// /activity — the company-wide "who's doing what" feed. Every agent's in-flight
// work and recent output in one place, newest first, auto-refreshing.
// ---------------------------------------------------------------------------
import ActivityFeed from "@/components/activity-feed";

export const metadata = { title: "Activity · Tilt HQ" };

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-gray-100">Company Activity</h1>
        <p className="mt-1 text-sm text-gray-500">
          What everyone&apos;s working on right now, and everything they&apos;ve done lately —
          live across the whole company.
        </p>
      </div>
      <ActivityFeed
        endpoint="/api/activity"
        title="Across the company"
        showAgent
        emptyHint="Quiet right now. Dispatched work and scheduled runs will show up here as they happen."
      />
    </div>
  );
}
