ALTER TABLE "business_public_profiles" ADD COLUMN "map_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_public_profiles" ADD COLUMN "place_id" text;