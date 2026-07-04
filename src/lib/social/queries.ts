import { asc, desc, eq, sql as raw } from "drizzle-orm";
import { db } from "./db";
import {
  assets,
  posts,
  planSkeleton,
  gaps,
  studioAssets,
  type Asset,
  type Post,
  type SkeletonRow,
  type Gap,
  type StudioAsset,
} from "./db/schema";

type PostStatus = Post["status"];
type GapStatus = Gap["status"];
import { isDemoMode, getDemoAssets } from "./demo-data";
import { DEMO_POSTS, DEMO_GAPS } from "./demo-plan";
import { DEMO_STUDIO } from "./demo-studio";
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

export type PostWithAsset = Post & {
  assetUrl: string | null;
  assetType: "photo" | "video" | null;
};

/**
 * Locked-window posts joined with their matched source asset, so the UI can
 * show the real photo/clip as a preview until the final render exists.
 */
export async function listPostsWithAssets(): Promise<PostWithAsset[]> {
  if (isDemoMode()) {
    return DEMO_POSTS.map((p) => ({ ...p, assetUrl: null, assetType: null }));
  }
  const rows = await db
    .select({ post: posts, assetUrl: assets.blobUrl, assetType: assets.type })
    .from(posts)
    .leftJoin(assets, eq(posts.assetId, assets.id))
    .orderBy(asc(posts.scheduledDate))
    .limit(500);
  return rows.map((r) => ({
    ...r.post,
    assetUrl: r.assetUrl ?? null,
    assetType: r.assetType ?? null,
  }));
}

/** Open gaps = the founder's shot list. */
export async function listGaps(): Promise<Gap[]> {
  if (isDemoMode()) return DEMO_GAPS;
  return db.select().from(gaps).orderBy(asc(gaps.weekStart)).limit(200);
}

// ---- Phase 5 review/approve mutations (posts + gaps) ----

export async function getPostById(id: string): Promise<Post | null> {
  if (isDemoMode()) return DEMO_POSTS.find((p) => p.id === id) ?? null;
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Approve / send a post back to review. */
export async function updatePostStatus(
  id: string,
  status: PostStatus,
): Promise<Post | null> {
  const rows = await db
    .update(posts)
    .set({ status, updatedAt: raw`now()` })
    .where(eq(posts.id, id))
    .returning();
  return rows[0] ?? null;
}

/** Founder edits to the copy/hashtags/CTA. Only provided fields are touched. */
export async function updatePostContent(
  id: string,
  fields: { copy?: string; hashtags?: string[]; cta?: string },
): Promise<Post | null> {
  const rows = await db
    .update(posts)
    .set({
      ...(fields.copy !== undefined ? { copy: fields.copy } : {}),
      ...(fields.hashtags !== undefined ? { hashtags: fields.hashtags } : {}),
      ...(fields.cta !== undefined ? { cta: fields.cta } : {}),
      // An edited post is no longer auto-approved — send it back to review.
      status: "needs_review",
      updatedAt: raw`now()`,
    })
    .where(eq(posts.id, id))
    .returning();
  return rows[0] ?? null;
}

/**
 * Flip a manual-edit video post onto the Shotstack auto-cut pipeline. Keeps
 * the copy/hashtags/CTA untouched; clears the visual so the next render pass
 * cuts the branded reel automatically.
 */
export async function convertPostToAutoCut(id: string): Promise<Post | null> {
  const post = (await db.select().from(posts).where(eq(posts.id, id)).limit(1))[0];
  if (!post) return null;
  if (post.renderKind !== "manual") {
    throw new Error("Only manual-edit posts can switch to the auto-cut.");
  }
  if (!post.assetId) {
    throw new Error("No matched clip — Regenerate the post first.");
  }
  const a = (await db.select().from(assets).where(eq(assets.id, post.assetId)).limit(1))[0];
  if (a?.type !== "video") {
    throw new Error("The matched asset isn't a video — the auto-cut needs a clip.");
  }
  const rows = await db
    .update(posts)
    .set({ renderKind: "shotstack", renderUrl: null, updatedAt: raw`now()` })
    .where(eq(posts.id, id))
    .returning();
  return rows[0] ?? null;
}

/** Mark a gap shot / dismissed / reopened. */
export async function updateGapStatus(
  id: string,
  status: GapStatus,
): Promise<Gap | null> {
  const rows = await db
    .update(gaps)
    .set({ status })
    .where(eq(gaps.id, id))
    .returning();
  return rows[0] ?? null;
}

// ---- Studio (freeform brand content) ----

/** Recent Studio generations, newest first. */
export async function listStudioAssets(limit = 60): Promise<StudioAsset[]> {
  if (isDemoMode()) return DEMO_STUDIO;
  return db
    .select()
    .from(studioAssets)
    .orderBy(desc(studioAssets.createdAt))
    .limit(limit);
}
