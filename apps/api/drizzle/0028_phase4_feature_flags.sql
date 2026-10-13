ALTER TABLE "business_settings" ADD COLUMN "reminder_hours" jsonb DEFAULT '[3]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "waitlist_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "discount_codes_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "review_requests_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "remember_customer_enabled" boolean DEFAULT false NOT NULL;