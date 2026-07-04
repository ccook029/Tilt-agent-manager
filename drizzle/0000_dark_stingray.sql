DO $$ BEGIN CREATE TYPE "public"."asset_type" AS ENUM('photo', 'video'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gap_status" AS ENUM('open', 'shot', 'dismissed'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."post_status" AS ENUM('draft', 'needs_review', 'approved', 'published'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."render_kind" AS ENUM('nano', 'shotstack', 'manual'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workdrive_id" text NOT NULL,
	"workdrive_path" text,
	"filename" text NOT NULL,
	"blob_url" text,
	"type" "asset_type" NOT NULL,
	"mime_type" text,
	"bytes" text,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suitable_post_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tagged_at" timestamp with time zone,
	"tagging_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_workdrive_id_unique" UNIQUE("workdrive_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"needed_asset_description" text NOT NULL,
	"status" "gap_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"config" jsonb NOT NULL,
	"active" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_skeleton" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"pillar_allocations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pinned_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_skeleton_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_date" date,
	"platform" text NOT NULL,
	"pillar" text NOT NULL,
	"format" text,
	"copy" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta" text,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"asset_id" uuid,
	"render_url" text,
	"edit_brief" text,
	"render_kind" "render_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "posts" ADD CONSTRAINT "posts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_type_idx" ON "assets" USING btree ("type");
