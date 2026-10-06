CREATE TABLE "subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"payment_method" text NOT NULL,
	"external_payment_id" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoices_plan_ck" CHECK ("subscription_invoices"."plan" in ('monthly','yearly')),
	CONSTRAINT "subscription_invoices_payment_method_ck" CHECK ("subscription_invoices"."payment_method" in ('card','paypal','bank_transfer')),
	CONSTRAINT "subscription_invoices_amount_ck" CHECK ("subscription_invoices"."amount" >= 0 and "subscription_invoices"."amount" <= 1000000000)
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "tax_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_invoices_business_idx" ON "subscription_invoices" USING btree ("business_id","created_at" DESC NULLS LAST);