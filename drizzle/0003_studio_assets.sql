CREATE TABLE "studio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"brief" text,
	"display_text" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"base_asset_id" uuid,
	"logo" boolean DEFAULT true NOT NULL,
	"render_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_assets" ADD CONSTRAINT "studio_assets_base_asset_id_assets_id_fk" FOREIGN KEY ("base_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_assets_kind_idx" ON "studio_assets" USING btree ("kind");