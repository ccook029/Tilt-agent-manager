CREATE TABLE "fundraisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_name" text NOT NULL,
	"payment_email" text,
	"deadline" date NOT NULL,
	"note" text,
	"blanket_url" text,
	"copy" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta" text,
	"graphic_line" text,
	"image_url" text,
	"status" "post_status" DEFAULT 'needs_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
