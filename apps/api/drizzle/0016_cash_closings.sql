CREATE TABLE "cash_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"day" date NOT NULL,
	"opening_amount" integer NOT NULL,
	"counted_amount" integer NOT NULL,
	"expected_amount" integer NOT NULL,
	"difference" integer NOT NULL,
	"total_sales" integer NOT NULL,
	"total_tip" integer NOT NULL,
	"total_expenses" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"closed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_closings_status_ck" CHECK ("cash_closings"."status" in ('completed','voided'))
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"description" text NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_method_ck" CHECK ("expenses"."method" in ('cash','card','nequi','bank_transfer','other')),
	CONSTRAINT "expenses_amount_ck" CHECK ("expenses"."amount" > 0 and "expenses"."amount" <= 1000000000)
);
--> statement-breakpoint
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_closed_by_fk" FOREIGN KEY ("closed_by","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_voided_by_fk" FOREIGN KEY ("voided_by","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fk" FOREIGN KEY ("created_by","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_closings_business_day_active_uq" ON "cash_closings" USING btree ("business_id","day") WHERE "cash_closings"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "cash_closings_business_idx" ON "cash_closings" USING btree ("business_id","day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expenses_business_idx" ON "expenses" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Aislamiento por negocio con Row Level Security, igual que ventas (0014_sales.sql). Cerrar caja lee sales/service_records
-- (sin RLS todavía) además de estas dos tablas nuevas, así que esa ruta corre con `withBusinessTrusted`; listar/consultar
-- gastos y cierres sí usa el rol restringido y queda cubierto por estas políticas.
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "expenses_tenant" ON "expenses" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "cash_closings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cash_closings_tenant" ON "cash_closings" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "expenses", "cash_closings" TO xiro_app;