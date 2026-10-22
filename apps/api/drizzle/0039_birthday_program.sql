-- Programa de cumpleaños (ver packages/shared/src/birthday.ts). Migración ADITIVA: una columna opcional (clients.birth_date,
-- sin valor por defecto: nadie queda con fecha) y dos tablas nuevas. El programa nace APAGADO para todos los negocios.
-- La restricción única birthday_rewards_once_uq garantiza UNA recompensa por negocio, cliente y año.
-- Reversión: drizzle/rollback/0039_birthday_program.down.sql
CREATE TABLE "birthday_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reward_kind" text DEFAULT 'percent' NOT NULL,
	"reward_value" integer DEFAULT 10 NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"valid_days" integer DEFAULT 7 NOT NULL,
	"min_total" integer DEFAULT 0 NOT NULL,
	"combinable" boolean DEFAULT false NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "birthday_programs_kind_ck" CHECK ("birthday_programs"."reward_kind" in ('percent','fixed')),
	CONSTRAINT "birthday_programs_value_ck" CHECK (("birthday_programs"."reward_kind" = 'percent' and "birthday_programs"."reward_value" between 1 and 100) or ("birthday_programs"."reward_kind" = 'fixed' and "birthday_programs"."reward_value" between 1 and 1000000000)),
	CONSTRAINT "birthday_programs_scope_ck" CHECK ("birthday_programs"."scope" in ('all','services','products')),
	CONSTRAINT "birthday_programs_days_ck" CHECK ("birthday_programs"."valid_days" between 1 and 60),
	CONSTRAINT "birthday_programs_min_ck" CHECK ("birthday_programs"."min_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "birthday_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reward_kind" text NOT NULL,
	"reward_value" integer NOT NULL,
	"scope" text NOT NULL,
	"min_total" integer NOT NULL,
	"combinable" boolean NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"amount" integer,
	"used_at" timestamp with time zone,
	"sale_id" uuid,
	"appointment_id" uuid,
	"product_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "birthday_rewards_status_ck" CHECK ("birthday_rewards"."status" in ('available','claimed','redeemed')),
	CONSTRAINT "birthday_rewards_kind_ck" CHECK ("birthday_rewards"."reward_kind" in ('percent','fixed')),
	CONSTRAINT "birthday_rewards_scope_ck" CHECK ("birthday_rewards"."scope" in ('all','services','products')),
	CONSTRAINT "birthday_rewards_range_ck" CHECK ("birthday_rewards"."ends_on" >= "birthday_rewards"."starts_on"),
	CONSTRAINT "birthday_rewards_use_ck" CHECK (("birthday_rewards"."status" = 'available' and "birthday_rewards"."amount" is null and "birthday_rewards"."used_at" is null and "birthday_rewards"."sale_id" is null and "birthday_rewards"."appointment_id" is null and "birthday_rewards"."product_order_id" is null)
        or ("birthday_rewards"."status" in ('claimed','redeemed') and "birthday_rewards"."amount" >= 0 and "birthday_rewards"."used_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "birthday_programs" ADD CONSTRAINT "birthday_programs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_rewards" ADD CONSTRAINT "birthday_rewards_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_rewards" ADD CONSTRAINT "birthday_rewards_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_rewards" ADD CONSTRAINT "birthday_rewards_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_rewards" ADD CONSTRAINT "birthday_rewards_product_order_id_product_orders_id_fk" FOREIGN KEY ("product_order_id") REFERENCES "public"."product_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_rewards" ADD CONSTRAINT "birthday_rewards_client_fk" FOREIGN KEY ("client_id","business_id") REFERENCES "public"."clients"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "birthday_programs_business_uq" ON "birthday_programs" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "birthday_rewards_once_uq" ON "birthday_rewards" USING btree ("business_id","client_id","year");--> statement-breakpoint
CREATE INDEX "birthday_rewards_business_idx" ON "birthday_rewards" USING btree ("business_id","starts_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "birthday_rewards_sale_idx" ON "birthday_rewards" USING btree ("sale_id") WHERE "birthday_rewards"."sale_id" is not null;--> statement-breakpoint
CREATE INDEX "birthday_rewards_appointment_idx" ON "birthday_rewards" USING btree ("appointment_id") WHERE "birthday_rewards"."appointment_id" is not null;--> statement-breakpoint
CREATE INDEX "birthday_rewards_order_idx" ON "birthday_rewards" USING btree ("product_order_id") WHERE "birthday_rewards"."product_order_id" is not null;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "birthday_programs", "birthday_rewards" TO xiro_app;--> statement-breakpoint
ALTER TABLE "birthday_programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "birthday_programs_tenant" ON "birthday_programs" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "birthday_rewards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "birthday_rewards_tenant" ON "birthday_rewards" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);
