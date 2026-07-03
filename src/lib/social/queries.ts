import { asc, desc, eq, sql as raw } from "drizzle-orm";
import { db } from "./db";
import {
  assets,
  posts,
  planSkeleton,
  gaps,
  type Asset,
  type Post,
  type SkeletonRow,
  type Gap,
} from "./db/schema";
import { isDemoMode, getDemoAssets } from "./demo-data";
import { DEMO_POSTS, DEMO_GAPS } from "./demo-plan";
import { getActiveKbConfig } from "./kb/config";
import { buildSkeleton, type SkeletonWeek } from "./planner/schedule";

export type CatalogStats = {
  total: number;
  photos: number;
  videos: number;
  tagged: number;
  untagged: number;
};

function statsFromAssets(rows: Asset[]): CatalogStats {
  const photos = rows.filter((r) => r.type === "photo").length;
  const videos = rows.filter((r) => r.type === "video").length;
  const tagged = rows.filter((r) => r.taggedAt != null).length;
  return { total: rows.length, photos, videos, tagged, untagged: rows.length - tagged };
}

export async function getCatalogStats(): Promise<CatalogStats> {
  // Demo mode (no DATABASE_URL): serve the built-in sample catalog so the
  // front-end is fully clickable with zero backend.
  if (isDemoMode()) return statsFromAssets(getDemoAssets());

  const rows = await db
    .select({
      total: raw<number>`count(*)::int`,
      photos: raw<number>`count(*) filter (where ${assets.type} = 'photo')::int`,
      videos: raw<number>`count(*) filter (where ${assets.type} = 'video')::int`,
      tagged: raw<number>`count(*) filter (where ${assets.taggedAt} is not null)::int`,
    })
    .from(assets);
  const r = rows[0] ?? { total: 0, photos: 0, videos: 0, tagged: 0 };
  return { ...r, untagged: r.total - r.tagged };
}

export async function listAssets(params?: {
  type?: "photo" | "video";
  limit?: number;
}): Promise<Asset[]> {
  const limit = params?.limit ?? 500;

  if (isDemoMode()) {
    let rows = getDemoAssets();
    if (params?.type) rows = rows.filter((r) => r.type === params.type);
    return rows.slice(0, limit);
  }

  if (params?.type) {
    return db
      .select()
      .from(assets)
      .where(eq(assets.type, params.type))
      .orderBy(desc(assets.createdAt))
      .limit(limit);
  }
  return db.select().from(assets).orderBy(desc(assets.createdAt)).limit(limit);
}

// ---- Phase 2 read models (plan / posts / gaps) ----

export type SkeletonView =
  | { source: "demo"; weeks: SkeletonWeek[] }
  | { source: "db"; weeks: SkeletonWeek[] };

/** The living 6-month skeleton. In demo mode it's generated live (no AI). */
export async function getSkeleton(weeks = 26): Promise<SkeletonView> {
  if (isDemoMode()) {
    const kb = await getActiveKbConfig();
    return { source: "demo", weeks: buildSkeleton(new Date(), weeks, kb) };
  }
  const rows: SkeletonRow[] = await db
    .select()
    .from(planSkeleton)
    .orderBy(asc(planSkeleton.weekStart))
    .limit(weeks);
  if (rows.length === 0) {
    const kb = await getActiveKbConfig();
    return { source: "db", weeks: buildSkeleton(new Date(), weeks, kb) };
  }
  return {
    source: "db",
    weeks: rows.map((r) => ({
      weekStart: r.weekStart,
      pillarAllocations: r.pillarAllocations,
      pinnedEvents: r.pinnedEvents.map((e) => ({ label: e.label, note: e.note ?? "" })),
    })),
  };
}

/** Locked-window posts, newest scheduled first. */
export async function listPosts(): Promise<Post[]> {
  if (isDemoMode()) return DEMO_POSTS;
  return db.select().from(posts).orderBy(asc(posts.scheduledDate)).limit(500);
}

/** Open gaps = the founder's shot list. */
export async function listGaps(): Promise<Gap[]> {
  if (isDemoMode()) return DEMO_GAPS;
  return db.select().from(gaps).orderBy(asc(gaps.weekStart)).limit(200);
}
