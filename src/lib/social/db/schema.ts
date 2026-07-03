import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  date,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

/**
 * Data model — Section 6 of the build spec.
 *
 * Phase 1 only needs `assets`, but the full schema is defined up front so later
 * phases (planning brain, render pipelines, portal, email) bolt on without a
 * migration rewrite. Tables for later phases are intentionally lightweight here.
 */

export const assetTypeEnum = pgEnum("asset_type", ["photo", "video"]);

export const postStatusEnum = pgEnum("post_status", [
  "draft",
  "needs_review",
  "approved",
  "published",
  // "scheduled" is added in the publisher phase.
]);

export const renderKindEnum = pgEnum("render_kind", [
  "nano",
  "shotstack",
  "manual",
]);

export const gapStatusEnum = pgEnum("gap_status", ["open", "shot", "dismissed"]);

/**
 * assets — the tagged catalog. Source of truth for "what we can actually post".
 * tags is a flexible jsonb bag: { product, person, action ("action"|"static"),
 * setting, orientation, ... } so the vision pass can enrich it over time.
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workdriveId: text("workdrive_id").notNull().unique(),
    workdrivePath: text("workdrive_path"),
    filename: text("filename").notNull(),
    blobUrl: text("blob_url"),
    type: assetTypeEnum("type").notNull(),
    mimeType: text("mime_type"),
    bytes: text("bytes"),
    tags: jsonb("tags").$type<AssetTags>().notNull().default({}),
    suitablePostTypes: jsonb("suitable_post_types")
      .$type<string[]>()
      .notNull()
      .default([]),
    // Tagging lifecycle so a re-runnable pass can skip already-tagged files.
    taggedAt: timestamp("tagged_at", { withTimezone: true }),
    taggingModel: text("tagging_model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("assets_type_idx").on(t.type)],
);

/**
 * posts — finished/locked-window posts produced by the planning brain.
 * Defined now; populated in Phase 2+.
 */
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduledDate: date("scheduled_date"),
  platform: text("platform").notNull(),
  pillar: text("pillar").notNull(),
  format: text("format"),
  copy: text("copy"),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  cta: text("cta"),
  status: postStatusEnum("status").notNull().default("draft"),
  assetId: uuid("asset_id").references(() => assets.id),
  renderUrl: text("render_url"),
  editBrief: text("edit_brief"),
  renderKind: renderKindEnum("render_kind"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * plan_skeleton — the rolling 6-month plan: loose pillar allocations + pinned
 * events per week. Defined now; populated in Phase 2.
 */
export const planSkeleton = pgTable("plan_skeleton", {
  id: uuid("id").primaryKey().defaultRandom(),
  weekStart: date("week_start").notNull().unique(),
  pillarAllocations: jsonb("pillar_allocations")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  pinnedEvents: jsonb("pinned_events").$type<PinnedEvent[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * kb_config — versioned brand/product/calendar/voice config. Editable, not
 * hardcoded. Defined now; the active row drives the brain in Phase 2.
 */
export const kbConfig = pgTable("kb_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  active: text("active").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * gaps — what the plan needed but the library lacks = the founder's shot list.
 * Defined now; populated in Phase 2.
 */
export const gaps = pgTable("gaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  weekStart: date("week_start").notNull(),
  neededAssetDescription: text("needed_asset_description").notNull(),
  status: gapStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---- Shared TS types ----

export type AssetTags = {
  product?: string | null;
  person?: string | null;
  /** "action" or "static" */
  action?: "action" | "static" | null;
  setting?: string | null;
  orientation?: "portrait" | "landscape" | "square" | null;
  /** Free-form descriptors the vision pass surfaces. */
  keywords?: string[];
  /** One-line human-readable description. */
  description?: string | null;
  /** Pillars this asset is well-suited to (1..6). */
  pillars?: number[];
};

export type PinnedEvent = {
  label: string;
  date?: string;
  note?: string;
};

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

export type SkeletonRow = typeof planSkeleton.$inferSelect;
export type Gap = typeof gaps.$inferSelect;
