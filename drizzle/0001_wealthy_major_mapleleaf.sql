CREATE TYPE "public"."announcement_kind" AS ENUM('partner', 'ambassador');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "announcement_kind" NOT NULL,
	"name" text NOT NULL,
	"subtitle" text,
	"source_url" text,
	"copy" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta" text,
	"image_url" text,
	"status" "post_status" DEFAULT 'needs_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
