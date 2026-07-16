import Link from "next/link";
import {
  getCatalogStats,
  listPostsWithAssets,
  listGaps,
  type CatalogStats,
  type PostWithAsset,
} from "@/lib/social/queries";
import type { Gap } from "@/lib/social/db/schema";
import { isDemoMode } from "@/lib/social/demo-data";
import { needsRender } from "@/lib/social/render/version";
import { rollForwardSchedule } from "@/lib/social/planner/rollforward";
import { PieceRow, groupPieces, formatDay } from "@/components/social/PieceRow";

export const dynamic = "force-dynamic";

export default async function Home() {
  let stats: CatalogStats = { total: 0, photos: 0, videos: 0, tagged: 0, untagged: 0 };
  let posts: PostWithAsset[] = [];
  let gaps: Gap[] = [];
  let error: string | null = null;
  try {
    if (!isDemoMode()) await rollForwardSchedule().catch(() => {});
    [stats, posts, gaps] = await Promise.all([
      getCatalogStats(),
      listPostsWithAssets(),
      listGaps(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayPosts = posts.filter((p) => p.scheduledDate === today);
  const upcoming = posts.filter((p) => (p.scheduledDate ?? "") > today);
  const nextDate = upcoming[0]?.scheduledDate ?? null;
  const nextPosts = nextDate ? upcoming.filter((p) => p.scheduledDate === nextDate) : [];

  const total = posts.length;
  const approved = posts.filter((p) => p.status === "approved" || p.status === "published").length;
  const needsReview = posts.filter((p) => p.status === "needs_review").length;
  const pendingRenders = posts.filter(needsRender).length;
  const openGaps = gaps.filter((g) => g.status === "open").length;
  const allApproved = total > 0 && approved === total;

  const steps = buildSteps({ stats, total, approved, pendingRenders });

  return (
    <div className="container">
      <section className="hero hero--dash">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/tilt-logo.png" alt="Tilt Hockey" className="hero__logo" />
        <p className="tagline">Social Command Center · {formatToday()}</p>
        <h1>
          Plan it. Brand it.{" "}
          <span style={{ color: "var(--tilt-cyan)" }}>Go full tilt.</span>
        </h1>
      </section>

      {error ? (
        <div className="empty">
          <p>Couldn&apos;t load the dashboard.</p>
          <p style={{ fontSize: "0.8rem" }}>{error}</p>
        </div>
      ) : (
        <div className="dash">
          <section className="dash__col">
            <h2 className="dash__heading">What needs doing</h2>
            {total === 0 ? (
              <Link href="/studio/social/setup" className="task task--primary">
                <span className="task__count">1</span>
                <span className="task__body">
                  <strong>Generate the plan</strong>
                  <span>
                    No posts written yet — hit <em>Generate plan</em> on Setup to fill
                    the locked two-week window.
                  </span>
                </span>
                <span className="task__go">→</span>
              </Link>
            ) : (
              <>
                {needsReview > 0 && (
                  <Link href="/studio/social/posts" className="task task--primary">
                    <span className="task__count">{needsReview}</span>
                    <span className="task__body">
                      <strong>Posts waiting for your approval</strong>
                      <span>
                        {approved} of {total} approved in the locked window — review the
                        copy + visual, approve or send back.
                      </span>
                    </span>
                    <span className="task__go">→</span>
                  </Link>
                )}
                {pendingRenders > 0 && (
                  <Link href="/studio/social/posts" className="task">
                    <span className="task__count">{pendingRenders}</span>
                    <span className="task__body">
                      <strong>Images still to render</strong>
                      <span>
                        Opening the Posts page generates them automatically — give it a
                        minute.
                      </span>
                    </span>
                    <span className="task__go">→</span>
                  </Link>
                )}
                {openGaps > 0 && (
                  <Link href="/studio/social/gaps" className="task">
                    <span className="task__count">{openGaps}</span>
                    <span className="task__body">
                      <strong>Shots to capture</strong>
                      <span>
                        The brain flagged slots with no matching asset — your shot list.
                      </span>
                    </span>
                    <span className="task__go">→</span>
                  </Link>
                )}
                {stats.untagged > 0 && (
                  <Link href="/studio/social/setup" className="task">
                    <span className="task__count">{stats.untagged}</span>
                    <span className="task__body">
                      <strong>Assets not tagged yet</strong>
                      <span>Run a sync on Setup so the brain can use them.</span>
                    </span>
                    <span className="task__go">→</span>
                  </Link>
                )}
                {allApproved && (
                  <div className="task task--done">
                    <span className="task__count">✓</span>
                    <span className="task__body">
                      <strong>Locked window fully approved</strong>
                      <span>
                        All {total} posts signed off. Next: the publisher phase ships
                        these automatically, and the brain rolls the plan forward.
                      </span>
                    </span>
                  </div>
                )}
                {!allApproved && needsReview === 0 && pendingRenders === 0 && openGaps === 0 && stats.untagged === 0 && (
                  <div className="task task--done">
                    <span className="task__count">✓</span>
                    <span className="task__body">
                      <strong>Nothing pending</strong>
                      <span>You&apos;re all caught up.</span>
                    </span>
                  </div>
                )}
              </>
            )}

            <h2 className="dash__heading" style={{ marginTop: 28 }}>
              {todayPosts.length > 0 ? "Going out today" : "Up next"}
            </h2>
            {todayPosts.length > 0 ? (
              groupPieces(todayPosts).map((piece) => (
                <PieceRow key={`${piece.date}|${piece.pillar}`} piece={piece} showDay={false} />
              ))
            ) : nextPosts.length > 0 ? (
              <>
                <p className="dash__muted">
                  Nothing scheduled today. Next up — {formatDay(nextDate!)}:
                </p>
                {groupPieces(nextPosts).map((piece) => (
                  <PieceRow key={`${piece.date}|${piece.pillar}`} piece={piece} showDay={false} />
                ))}
              </>
            ) : (
              <p className="dash__muted">
                Nothing scheduled. Generate the plan on{" "}
                <Link href="/studio/social/setup" style={{ color: "var(--tilt-cyan)" }}>Setup</Link>.
              </p>
            )}
          </section>

          <section className="dash__col dash__col--side">
            <h2 className="dash__heading">Where we&apos;re at</h2>
            <ol className="steps">
              {steps.map((s) => (
                <li
                  key={s.label}
                  className={`step${s.done ? " step--done" : s.current ? " step--current" : ""}`}
                >
                  <span className="step__mark">{s.done ? "✓" : s.current ? "●" : "○"}</span>
                  <span className="step__body">
                    <strong>{s.label}</strong>
                    <span>{s.detail}</span>
                  </span>
                </li>
              ))}
            </ol>

            <h2 className="dash__heading" style={{ marginTop: 28 }}>Library</h2>
            <div className="dash-stats">
              <Link href="/studio/social/catalog" className="dash-stat">
                <span className="dash-stat__num">{stats.total}</span>
                <span className="dash-stat__label">assets</span>
              </Link>
              <Link href="/studio/social/catalog" className="dash-stat">
                <span className="dash-stat__num">{stats.photos}</span>
                <span className="dash-stat__label">photos</span>
              </Link>
              <Link href="/studio/social/catalog" className="dash-stat">
                <span className="dash-stat__num">{stats.videos}</span>
                <span className="dash-stat__label">videos</span>
              </Link>
              <Link href="/studio/social/gaps" className="dash-stat">
                <span className="dash-stat__num">{openGaps}</span>
                <span className="dash-stat__label">open gaps</span>
              </Link>
            </div>

            <div className="btn-row" style={{ marginTop: 24 }}>
              <Link href="/studio/social/plan" className="btn btn--ghost">Full plan</Link>
              <Link href="/studio/social/studio" className="btn btn--ghost">Studio</Link>
              <Link href="/studio/social/setup" className="btn btn--ghost">Setup</Link>
            </div>
          </section>
        </div>
      )}

      {isDemoMode() && !error && (
        <div className="preview-note" style={{ marginTop: 24 }}>
          Preview mode — sample data. Connect the database to see the live plan.
        </div>
      )}
    </div>
  );
}

function buildSteps({
  stats,
  total,
  approved,
  pendingRenders,
}: {
  stats: CatalogStats;
  total: number;
  approved: number;
  pendingRenders: number;
}) {
  const defs = [
    {
      label: "Library synced + tagged",
      detail:
        stats.total === 0
          ? "Sync WorkDrive on Setup"
          : `${stats.tagged} of ${stats.total} assets tagged`,
      done: stats.total > 0 && stats.untagged === 0,
    },
    {
      label: "Plan written",
      detail:
        total === 0
          ? "Generate the locked window on Setup"
          : `${total} posts in the locked 14 days`,
      done: total > 0,
    },
    {
      label: "Visuals rendered",
      detail:
        total === 0
          ? "Waiting on the plan"
          : pendingRenders === 0
            ? "Every static post has its image"
            : `${pendingRenders} still rendering`,
      done: total > 0 && pendingRenders === 0,
    },
    {
      label: "Founder approval",
      detail: total === 0 ? "Waiting on the plan" : `${approved} of ${total} approved`,
      done: total > 0 && approved === total,
    },
    {
      label: "Publish",
      detail: "Next phase — approved posts ship on schedule",
      done: false,
    },
  ];
  const firstOpen = defs.findIndex((d) => !d.done);
  return defs.map((d, i) => ({ ...d, current: i === firstOpen }));
}

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
