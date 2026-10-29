CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"service_ids" jsonb NOT NULL,
	"professional_id" uuid,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"token_hash" text NOT NULL,
	"notified_at" timestamp with time zone,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"terms_accepted_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_status_ck" CHECK ("waitlist_entries"."status" in ('waiting','notified','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_client_business_fk" FOREIGN KEY ("client_id","business_id") REFERENCES "public"."clients"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_token_uq" ON "waitlist_entries" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_client_date_uq" ON "waitlist_entries" USING btree ("business_id","client_id","date") WHERE "waitlist_entries"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "waitlist_business_date_idx" ON "waitlist_entries" USING btree ("business_id","date","created_at");--> statement-breakpoint
-- Aislamiento por negocio en la base (igual que citas y pedidos).
GRANT SELECT, INSERT, UPDATE, DELETE ON "waitlist_entries" TO xiro_app;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "waitlist_entries_tenant" ON "waitlist_entries" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);
