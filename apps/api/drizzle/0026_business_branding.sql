ALTER TABLE "business_public_profiles" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "business_public_profiles" ADD COLUMN "booking_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_public_profiles" ADD COLUMN "trust_badges" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "business_public_profiles" ADD CONSTRAINT "bpp_accent_ck" CHECK ("business_public_profiles"."accent_color" is null or "business_public_profiles"."accent_color" ~ '^#[0-9a-f]{6}$');