CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"total" integer NOT NULL,
	"employee_id" uuid,
	"service_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_items_kind_ck" CHECK ("sale_items"."kind" in ('service','product')),
	CONSTRAINT "sale_items_amounts_ck" CHECK ("sale_items"."quantity" > 0 and "sale_items"."unit_price" >= 0 and "sale_items"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount" integer NOT NULL,
	"received_amount" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_payments_method_ck" CHECK ("sale_payments"."method" in ('cash','card','nequi','bank_transfer','other')),
	CONSTRAINT "sale_payments_amount_ck" CHECK ("sale_payments"."amount" > 0 and ("sale_payments"."received_amount" is null or "sale_payments"."received_amount" >= "sale_payments"."amount"))
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid,
	"client_label" text DEFAULT '' NOT NULL,
	"subtotal" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"tip" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_id_business_uq" UNIQUE("id","business_id"),
	CONSTRAINT "sales_status_ck" CHECK ("sales"."status" in ('completed','voided')),
	CONSTRAINT "sales_amounts_ck" CHECK ("sales"."subtotal" >= 0 and "sales"."discount" >= 0 and "sales"."tip" >= 0 and "sales"."total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "is_occasional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_fk" FOREIGN KEY ("sale_id","business_id") REFERENCES "public"."sales"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_item_fk" FOREIGN KEY ("item_id","business_id") REFERENCES "public"."items"("id","business_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_employee_fk" FOREIGN KEY ("employee_id","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_fk" FOREIGN KEY ("sale_id","business_id") REFERENCES "public"."sales"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_fk" FOREIGN KEY ("client_id","business_id") REFERENCES "public"."clients"("id","business_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_fk" FOREIGN KEY ("created_by","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_fk" FOREIGN KEY ("voided_by","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_item_idx" ON "sale_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_business_idx" ON "sales" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_client_idx" ON "sales" USING btree ("client_id");--> statement-breakpoint
-- Aislamiento por negocio con Row Level Security, igual que mensajería (0013_messages.sql). Registrar y anular una venta
-- también tocan `items` (stock) y `service_records`/`loyalty_progress` (tablas sin RLS todavía), así que esas dos rutas
-- corren con `withBusinessTrusted` (mismo mecanismo que cerrar una cita) y quedan protegidas por el filtro de negocio en
-- cada consulta, no por RLS; listar y consultar una venta sí usan el rol restringido y quedan cubiertas por estas políticas.
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sales_tenant" ON "sales" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sale_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sale_items_tenant" ON "sale_items" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sale_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sale_payments_tenant" ON "sale_payments" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales", "sale_items", "sale_payments" TO xiro_app;