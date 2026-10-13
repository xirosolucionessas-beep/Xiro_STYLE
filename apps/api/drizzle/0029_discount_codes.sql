CREATE TABLE "discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"min_total" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"once_per_client" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_kind_ck" CHECK ("discount_codes"."kind" in ('percent','fixed')),
	CONSTRAINT "discount_codes_value_ck" CHECK (("discount_codes"."kind" = 'percent' and "discount_codes"."value" between 1 and 100) or ("discount_codes"."kind" = 'fixed' and "discount_codes"."value" between 1 and 1000000000)),
	CONSTRAINT "discount_codes_code_ck" CHECK ("discount_codes"."code" ~ '^[A-Z0-9_-]{3,30}$'),
	CONSTRAINT "discount_codes_uses_ck" CHECK ("discount_codes"."uses" >= 0 and ("discount_codes"."max_uses" is null or "discount_codes"."max_uses" >= 1)),
	CONSTRAINT "discount_codes_dates_ck" CHECK ("discount_codes"."starts_at" is null or "discount_codes"."ends_at" is null or "discount_codes"."starts_at" < "discount_codes"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_code_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_orders" ADD COLUMN "discount_code_id" uuid;--> statement-breakpoint
ALTER TABLE "product_orders" ADD COLUMN "discount_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_codes_business_code_uq" ON "discount_codes" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "discount_codes_business_idx" ON "discount_codes" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_discount_code_id_discount_codes_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Un descuento nunca es negativo ni mayor que el total bruto (la página jamás muestra un total a pagar menor que 0).
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_ck" CHECK ("discount_amount" between 0 and "total_price");--> statement-breakpoint
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_discount_ck" CHECK ("discount_amount" between 0 and "total_price");--> statement-breakpoint
-- Aislamiento por negocio en la base (igual que citas y pedidos): con el rol de la aplicación solo el negocio activo.
GRANT SELECT, INSERT, UPDATE, DELETE ON "discount_codes" TO xiro_app;--> statement-breakpoint
ALTER TABLE "discount_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "discount_codes_tenant" ON "discount_codes" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);
