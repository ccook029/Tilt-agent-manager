ALTER TABLE "announcements" ADD COLUMN "image_url_square" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "image_url_story" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "logo_position" text DEFAULT 'center' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "logo_scale" text DEFAULT 'md' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "lockup" boolean DEFAULT false NOT NULL;
