import Link from "next/link";
import { getSkeleton, listPostsWithAssets, type PostWithAsset } from "@/lib/social/queries";
import type { SkeletonWeek } from "@/lib/social/planner/schedule";
import { isDemoMode } from "@/lib/social/demo-data";
import { rollForwardSchedule } from "@/lib/social/planner/rollforward";
import { PieceRow, groupPieces } from "@/components/social/PieceRow";

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
  let posts: PostWithAsset[] = [];
  let error: string | null = null;
  try {
    if (!isDemoMode()) await rollForwardSchedule().catch(() => {});
    weeks = (await getSkeleton(26)).weeks;
    posts = await listPostsWithAssets();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const postsByWeek = groupByWeek(posts);
  // The locked window is wherever the posts actually sit (the schedule rolls
  // forward day by day), so every post in the table is locked-window inventory.
  const lockedPosts = posts;
  const lockedApproved = lockedPosts.filter((p) => p.status === "approved" || p.status === "published").length;

  return (
    <div className="container">
      <p className="tagline">Living plan · rolling 6 months</p>
      <h1>Content Plan</h1>
      <p style={{ color: "var(--tilt-muted)", maxWidth: 680 }}>
        The plan works backwards from the posts. The{" "}
        <strong style={{ color: "var(--tilt-cyan)" }}>locked window</strong> (the
        next two weeks) is fully written — every piece below is a real post you
        approve on the <Link href="/studio/social/posts" style={{ color: "var(--tilt-cyan)" }}>Posts page</Link>,
        and its approval status flows back here. Days that pass without posting
        simply roll forward — the queue slides to today, nothing is lost and no
        credits are spent. Everything after the locked window is just the
        skeleton: weekly pillar quotas and pinned events that stay loose.
      </p>

      {error ? (
        <div className="empty">
          <p>Couldn&apos;t load the plan.</p>
          <p style={{ fontSize: "0.8rem" }}>{error}</p>
        </div>
      ) : (
        <>
          {lockedPosts.length > 0 && (
            <div className="week-progress week-progress--banner">
              <span>
                Locked window: <strong>{lockedApproved} of {lockedPosts.length}</strong> posts approved
              </span>
              <Link href="/studio/social/posts">Review &amp; approve →</Link>
            </div>
          )}

          <div className="week-list">
            {weeks.map((wk, i) => {
              const weekPosts = postsByWeek.get(wk.weekStart) ?? [];
              const locked = posts.length > 0 ? weekPosts.length > 0 : i < 2;
              return (
                <div className={`week-row${locked ? " week-row--locked" : ""}`} key={wk.weekStart}>
                  <div className="week-row__date">
                    <div className="week-row__label">{locked ? "Locked" : `Week ${i + 1}`}</div>
                    <div className="week-row__start">{formatWeek(wk.weekStart)}</div>
                  </div>
                  <div className="week-row__body">
                    {locked ? (
                      <LockedWeek weekPosts={weekPosts} allocations={wk.pillarAllocations} />
                    ) : (
                      <div className="tags">
                        {Object.entries(wk.pillarAllocations).map(([key, count]) => (
                          <span key={key} className="chip cyan">
                            {(PILLAR_LABEL[key] ?? key)} ×{count}
                          </span>
                        ))}
                      </div>
                    )}
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
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function LockedWeek({
  weekPosts,
  allocations,
}: {
  weekPosts: PostWithAsset[];
  allocations: Record<string, number>;
}) {
  if (weekPosts.length === 0) {
    return (
      <>
        <div className="tags">
          {Object.entries(allocations).map(([key, count]) => (
            <span key={key} className="chip cyan">
              {(PILLAR_LABEL[key] ?? key)} ×{count}
            </span>
          ))}
        </div>
        <p style={{ color: "var(--tilt-muted)", fontSize: "0.8rem", margin: 0 }}>
          No posts written for this week yet — run <strong>Generate plan</strong> on
          the Setup page.
        </p>
      </>
    );
  }

  const approved = weekPosts.filter((p) => p.status === "approved" || p.status === "published").length;
  return (
    <>
      <div className="week-progress">
        <span>
          {approved} of {weekPosts.length} posts approved
        </span>
        <Link href="/studio/social/posts">Review →</Link>
      </div>
      {groupPieces(weekPosts).map((piece) => (
        <PieceRow key={`${piece.date}|${piece.pillar}`} piece={piece} />
      ))}
    </>
  );
}

function groupByWeek(posts: PostWithAsset[]): Map<string, PostWithAsset[]> {
  const map = new Map<string, PostWithAsset[]>();
  for (const p of posts) {
    if (!p.scheduledDate) continue;
    const ws = weekStartOf(p.scheduledDate);
    const list = map.get(ws) ?? [];
    list.push(p);
    map.set(ws, list);
  }
  return map;
}

function weekStartOf(iso: string): string {
  const d = new Date(iso);
  const diff = (d.getUTCDay() + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function formatWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
