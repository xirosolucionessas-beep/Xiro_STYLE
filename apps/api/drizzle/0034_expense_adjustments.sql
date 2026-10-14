CREATE TABLE "expense_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"cash_day" date NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"amount_before" integer NOT NULL,
	"amount_after" integer NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_adjustments_kind_ck" CHECK ("expense_adjustments"."kind" in ('edit','void'))
);
--> statement-breakpoint
ALTER TABLE "expense_adjustments" ADD CONSTRAINT "expense_adjustments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_adjustments" ADD CONSTRAINT "expense_adjustments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_adjustments" ADD CONSTRAINT "expense_adjustments_created_by_fk" FOREIGN KEY ("created_by","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_adjustments_expense_idx" ON "expense_adjustments" USING btree ("business_id","expense_id");--> statement-breakpoint
CREATE INDEX "expense_adjustments_day_idx" ON "expense_adjustments" USING btree ("business_id","cash_day");--> statement-breakpoint
-- Protección por negocio (RLS) como el resto de tablas de un negocio. Solo se agrega: sin UPDATE ni DELETE para xiro_app.
ALTER TABLE "expense_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "expense_adjustments_tenant" ON "expense_adjustments" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON "expense_adjustments" TO xiro_app;
