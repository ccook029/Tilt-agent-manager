import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  date,
  integer,
  boolean,
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

export const announcementKindEnum = pgEnum("announcement_kind", [
  "partner",
  "ambassador",
]);

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

/**
 * announcements — one-off uniform posts (partnership / ambassador welcomes),
 * generated on demand from a name + uploaded logo/photo, outside the plan.
 */
export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: announcementKindEnum("kind").notNull(),
  /** Partner name, or the ambassador's full name. */
  name: text("name").notNull(),
  /** Ambassador's team / partner tagline — shown under the name. */
  subtitle: text("subtitle"),
  /** Uploaded source in Blob: partner logo PNG, or ambassador photo. */
  sourceUrl: text("source_url"),
  copy: text("copy"),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  cta: text("cta"),
  /** Short sentence typeset ON the graphic itself (no emoji/hashtags). */
  graphicLine: text("graphic_line"),
  /** The finished composited 4:5 graphic in Blob. */
  imageUrl: text("image_url"),
  /** Partner only: the same graphic in 1:1 and 9:16 (rendered together). */
  imageUrlSquare: text("image_url_square"),
  imageUrlStory: text("image_url_story"),
  /** Partner logo card placement — adjustable per card, re-composited instantly. */
  logoPosition: text("logo_position").notNull().default("center"),
  logoScale: text("logo_scale").notNull().default("md"),
  /** Show the partner mark × TILT mark side by side instead of a single card. */
  lockup: boolean("lockup").notNull().default(false),
  /** Partner website — typeset on the graphic + offered to the caption CTA. */
  website: text("website"),
  /** Partner accent hex (#RRGGBB) — logo-card border + website line color. */
  accentColor: text("accent_color"),
  status: postStatusEnum("status").notNull().default("needs_review"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * fundraisers — blanket pre-order fundraiser posts. A team/org partners with
 * Tilt to sell custom blankets; the founder uploads the finished blanket
 * rendering, picks a pre-order deadline, and the agent writes the caption +
 * builds the branded flyer. Price is fixed at $60/blanket (lives in code).
 */
export const fundraisers = pgTable("fundraisers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Organization / team name, e.g. "Jr. Lady Sting". */
  orgName: text("org_name").notNull(),
  /** Where supporters send payment / e-transfers. Shown on the flyer + caption. */
  paymentEmail: text("payment_email"),
  /** Pre-order deadline (varies per org — chosen with a date picker). */
  deadline: date("deadline").notNull(),
  /** Optional short note from the org to fold into the post. */
  note: text("note"),
  /** Uploaded blanket rendering in Blob — the hero image of the flyer. */
  blanketUrl: text("blanket_url"),
  copy: text("copy"),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  cta: text("cta"),
  /** Short sentence typeset ON the flyer itself (no emoji/hashtags). */
  graphicLine: text("graphic_line"),
  /** Free-form design feedback the founder wants folded into the next render. */
  revisionNote: text("revision_note"),
  /** The finished composited 4:5 flyer in Blob. */
  imageUrl: text("image_url"),
  status: postStatusEnum("status").notNull().default("needs_review"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * sock_designs — custom dress sock concepts Tilt pitches to teams/orgs. The
 * founder uploads the org logo and names the team colors; the agent designs a
 * dress sock mockup in those colors carrying the logo, then builds a Tilt-branded
 * pitch flyer around that mockup to sell the concept to the org. Two images per
 * row: the unbranded product mockup (designUrl) and the Tilt sales flyer
 * (flyerUrl).
 */
export const sockDesigns = pgTable("sock_designs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Organization / team name, e.g. "Jr. Lady Sting". */
  orgName: text("org_name").notNull(),
  /** Team colors, freeform, e.g. "Yellow, silver, black". */
  colors: text("colors"),
  /** Optional style direction from the founder. */
  note: text("note"),
  /** Uploaded org logo / crest in Blob — featured on the sock. */
  logoUrl: text("logo_url"),
  /** The unbranded dress sock product mockup in Blob. */
  designUrl: text("design_url"),
  /** The Tilt-branded pitch flyer in Blob. */
  flyerUrl: text("flyer_url"),
  /** Pitch copy for the org (short B2B pitch). */
  copy: text("copy"),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  cta: text("cta"),
  /** Short sentence typeset ON the pitch flyer itself (no emoji/hashtags). */
  graphicLine: text("graphic_line"),
  /** Free-form design feedback the founder wants folded into the next render. */
  revisionNote: text("revision_note"),
  status: postStatusEnum("status").notNull().default("needs_review"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * studio_assets — freeform, on-brand content generated in the Studio (desktop
 * backgrounds, phone wallpapers, posters, banners, …). Unlike `posts`, these are
 * not tied to the social plan/calendar; they're one-off brand pieces the founder
 * asks for directly. Same hard rules apply: a real photo is the base whenever a
 * subject is involved, and the TILT logo is composited by code, never AI-drawn.
 */
export const studioAssets = pgTable(
  "studio_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Preset key driving the canvas dimensions (desktop, phone, square, …). */
    kind: text("kind").notNull(),
    /** Short human label for the piece. */
    title: text("title").notNull(),
    /** The founder's freeform request, verbatim. */
    prompt: text("prompt").notNull(),
    /** The composed, guardrail-safe render brief sent to the image model. */
    brief: text("brief"),
    /** Optional display text rendered onto the image. */
    displayText: text("display_text"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Real catalog photo used as the base, when a subject is involved. */
    baseAssetId: uuid("base_asset_id").references(() => assets.id),
    /** Whether the TILT logo was composited in. */
    logo: boolean("logo").notNull().default(true),
    renderUrl: text("render_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("studio_assets_kind_idx").on(t.kind)],
);

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

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

export type Fundraiser = typeof fundraisers.$inferSelect;
export type NewFundraiser = typeof fundraisers.$inferInsert;

export type SockDesign = typeof sockDesigns.$inferSelect;
export type NewSockDesign = typeof sockDesigns.$inferInsert;

export type StudioAsset = typeof studioAssets.$inferSelect;
export type NewStudioAsset = typeof studioAssets.$inferInsert;
