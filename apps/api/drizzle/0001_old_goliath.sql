CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"external_event_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_events_source_ck" CHECK ("subscription_events"."source" in ('revenuecat','stripe','paypal','admin','system'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"plan" text,
	"status" text DEFAULT 'trial' NOT NULL,
	"platform" text NOT NULL,
	"payment_method" text,
	"trial_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"trial_claimed_by_user_id" uuid,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"next_billing_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"grace_period_ends_at" timestamp with time zone,
	"external_customer_id" text,
	"external_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_plan_ck" CHECK ("subscriptions"."plan" is null or "subscriptions"."plan" in ('monthly','yearly')),
	CONSTRAINT "subscriptions_status_ck" CHECK ("subscriptions"."status" in ('trial','active','past_due','expired','canceled')),
	CONSTRAINT "subscriptions_platform_ck" CHECK ("subscriptions"."platform" in ('ios','android','web')),
	CONSTRAINT "subscriptions_payment_method_ck" CHECK ("subscriptions"."payment_method" is null or "subscriptions"."payment_method" in ('card','paypal','bank_transfer'))
);
--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_claimed_by_user_id_users_id_fk" FOREIGN KEY ("trial_claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sub_events_business_idx" ON "subscription_events" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sub_events_external_uq" ON "subscription_events" USING btree ("source","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_business_uq" ON "subscriptions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_next_billing_idx" ON "subscriptions" USING btree ("next_billing_at");