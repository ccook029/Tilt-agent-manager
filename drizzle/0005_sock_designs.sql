CREATE TABLE "sock_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_name" text NOT NULL,
	"colors" text,
	"note" text,
	"logo_url" text,
	"design_url" text,
	"flyer_url" text,
	"copy" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta" text,
	"graphic_line" text,
	"status" "post_status" DEFAULT 'needs_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
