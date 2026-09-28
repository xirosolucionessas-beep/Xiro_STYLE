CREATE TABLE "appointment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_events_actor_ck" CHECK ("appointment_events"."actor_kind" in ('staff','client','system'))
);
--> statement-breakpoint
CREATE TABLE "appointment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item_id" uuid,
	"variant_id" uuid,
	"package_id" uuid,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "appointment_items_kind_ck" CHECK ("appointment_items"."kind" in ('service','package','product')),
	CONSTRAINT "appointment_items_qty_ck" CHECK ("appointment_items"."quantity" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"busy_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"customer_notes" text DEFAULT '' NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"total_price" integer DEFAULT 0 NOT NULL,
	"duration_minutes" integer NOT NULL,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"modification_count" integer DEFAULT 0 NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"terms_accepted_ip" text,
	"reminders_opt_in" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_id_business_uq" UNIQUE("id","business_id"),
	CONSTRAINT "appointments_status_ck" CHECK ("appointments"."status" in ('pending','confirmed','in_progress','completed','cancelled','no_show')),
	CONSTRAINT "appointments_source_ck" CHECK ("appointments"."source" in ('app','web','walk_in')),
	CONSTRAINT "appointments_order_ck" CHECK ("appointments"."starts_at" < "appointments"."ends_at" and "appointments"."ends_at" <= "appointments"."busy_until"),
	CONSTRAINT "appointments_total_ck" CHECK ("appointments"."total_price" between 0 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "business_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_public_profiles" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"privacy_policy" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"instagram" text DEFAULT '' NOT NULL,
	"facebook" text DEFAULT '' NOT NULL,
	"tiktok" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"cover_file" text,
	"gallery_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bpp_coords_ck" CHECK (("business_public_profiles"."latitude" is null) = ("business_public_profiles"."longitude" is null))
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"slot_interval_minutes" integer DEFAULT 30 NOT NULL,
	"min_notice_minutes" integer DEFAULT 60 NOT NULL,
	"max_days_ahead" integer DEFAULT 60 NOT NULL,
	"cancel_until_hours" integer DEFAULT 2 NOT NULL,
	"max_modifications" integer DEFAULT 2 NOT NULL,
	"auto_confirm" boolean DEFAULT true NOT NULL,
	"require_email" boolean DEFAULT true NOT NULL,
	"max_pending_per_phone" integer DEFAULT 3 NOT NULL,
	"hours_blocks" jsonb,
	"custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bs_interval_ck" CHECK ("business_settings"."slot_interval_minutes" in (15,30,60)),
	CONSTRAINT "bs_notice_ck" CHECK ("business_settings"."min_notice_minutes" between 0 and 10080),
	CONSTRAINT "bs_ahead_ck" CHECK ("business_settings"."max_days_ahead" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "business_slug_history" (
	"slug" text PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"bookable" boolean DEFAULT false NOT NULL,
	"public_name" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"photo_file" text,
	"visible" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_profiles_user_business_uq" UNIQUE("user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "employee_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	CONSTRAINT "employee_schedules_day_ck" CHECK ("employee_schedules"."weekday" between 0 and 6),
	CONSTRAINT "employee_schedules_order_ck" CHECK ("employee_schedules"."start_time" < "employee_schedules"."end_time")
);
--> statement-breakpoint
CREATE TABLE "employee_services" (
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"price_override" integer,
	"duration_override" integer,
	CONSTRAINT "employee_services_user_id_item_id_pk" PRIMARY KEY("user_id","item_id"),
	CONSTRAINT "employee_services_price_ck" CHECK ("employee_services"."price_override" is null or "employee_services"."price_override" between 0 and 1000000000),
	CONSTRAINT "employee_services_duration_ck" CHECK ("employee_services"."duration_override" is null or "employee_services"."duration_override" between 5 and 720)
);
--> statement-breakpoint
CREATE TABLE "employee_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "employee_time_off_order_ck" CHECK ("employee_time_off"."starts_at" < "employee_time_off"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"author_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_ck" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_status_ck" CHECK ("reviews"."status" in ('pending','approved','hidden'))
);
--> statement-breakpoint
CREATE TABLE "service_package_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid
);
--> statement-breakpoint
CREATE TABLE "service_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"duration_minutes" integer,
	"photo_file" text,
	"active" boolean DEFAULT true NOT NULL,
	"visible_on_web" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "service_packages_id_business_uq" UNIQUE("id","business_id"),
	CONSTRAINT "service_packages_price_ck" CHECK ("service_packages"."price" between 0 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "service_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"duration_minutes" integer,
	"photo_file" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "service_variants_id_business_uq" UNIQUE("id","business_id"),
	CONSTRAINT "service_variants_price_ck" CHECK ("service_variants"."price" between 0 and 1000000000),
	CONSTRAINT "service_variants_duration_ck" CHECK ("service_variants"."duration_minutes" is null or "service_variants"."duration_minutes" between 5 and 720)
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "kind" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "duration_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "cleanup_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "bookable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "kind_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_id_business_uq" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_id_business_uq" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_business_uq" UNIQUE("id","business_id");--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_fk" FOREIGN KEY ("appointment_id","business_id") REFERENCES "public"."appointments"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointment_fk" FOREIGN KEY ("appointment_id","business_id") REFERENCES "public"."appointments"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_business_fk" FOREIGN KEY ("client_id","business_id") REFERENCES "public"."clients"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_business_fk" FOREIGN KEY ("professional_id","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_closures" ADD CONSTRAINT "business_closures_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_public_profiles" ADD CONSTRAINT "business_public_profiles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_slug_history" ADD CONSTRAINT "business_slug_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_business_fk" FOREIGN KEY ("user_id","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_user_business_fk" FOREIGN KEY ("user_id","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_services" ADD CONSTRAINT "employee_services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_services" ADD CONSTRAINT "employee_services_user_business_fk" FOREIGN KEY ("user_id","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_services" ADD CONSTRAINT "employee_services_item_business_fk" FOREIGN KEY ("item_id","business_id") REFERENCES "public"."items"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_time_off" ADD CONSTRAINT "employee_time_off_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_time_off" ADD CONSTRAINT "employee_time_off_user_business_fk" FOREIGN KEY ("user_id","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointment_fk" FOREIGN KEY ("appointment_id","business_id") REFERENCES "public"."appointments"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_package_entries" ADD CONSTRAINT "service_package_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_package_entries" ADD CONSTRAINT "service_package_entries_package_fk" FOREIGN KEY ("package_id","business_id") REFERENCES "public"."service_packages"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_package_entries" ADD CONSTRAINT "service_package_entries_item_fk" FOREIGN KEY ("item_id","business_id") REFERENCES "public"."items"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_package_entries" ADD CONSTRAINT "service_package_entries_variant_fk" FOREIGN KEY ("variant_id","business_id") REFERENCES "public"."service_variants"("id","business_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_item_business_fk" FOREIGN KEY ("item_id","business_id") REFERENCES "public"."items"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_events_appointment_idx" ON "appointment_events" USING btree ("appointment_id","created_at");--> statement-breakpoint
CREATE INDEX "appointment_items_appointment_idx" ON "appointment_items" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_token_uq" ON "appointments" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "appointments_business_start_idx" ON "appointments" USING btree ("business_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_professional_start_idx" ON "appointments" USING btree ("business_id","professional_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_client_idx" ON "appointments" USING btree ("business_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_closures_day_uq" ON "business_closures" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX "business_slug_history_business_idx" ON "business_slug_history" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "employee_profiles_business_idx" ON "employee_profiles" USING btree ("business_id","sort_order");--> statement-breakpoint
CREATE INDEX "employee_schedules_user_idx" ON "employee_schedules" USING btree ("user_id","weekday");--> statement-breakpoint
CREATE INDEX "employee_services_item_idx" ON "employee_services" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "employee_time_off_user_idx" ON "employee_time_off" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_appointment_uq" ON "reviews" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "reviews_business_status_idx" ON "reviews" USING btree ("business_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_package_entries_package_idx" ON "service_package_entries" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "service_packages_business_idx" ON "service_packages" USING btree ("business_id","sort_order");--> statement-breakpoint
CREATE INDEX "service_variants_item_idx" ON "service_variants" USING btree ("item_id","sort_order");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_kind_ck" CHECK ("items"."kind" in ('service','product'));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_duration_ck" CHECK ("items"."duration_minutes" between 5 and 720);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_cleanup_ck" CHECK ("items"."cleanup_minutes" between 0 and 120);
--> statement-breakpoint
-- =====================================================================================================================
-- Citas: lo que Drizzle no expresa (extensión, restricción de exclusión, clasificación inicial, rol y Row Level Security).
-- =====================================================================================================================

-- Garantía contra el doble agendamiento: dos citas ACTIVAS del mismo profesional no pueden cruzarse en el tiempo
-- (rango [inicio, fin + limpieza)). Citas adyacentes sí se permiten; una cancelada o con inasistencia libera el horario.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap" EXCLUDE USING gist ("business_id" WITH =, "professional_id" WITH =, tstzrange("starts_at", "busy_until", '[)') WITH &&) WHERE ("status" IN ('pending','confirmed','in_progress','completed'));--> statement-breakpoint

-- Clasificación inicial de lo que ya existe: con existencias se trata como producto; el resto, como servicio. Queda
-- "sin confirmar" (kind_confirmed = false) hasta que el dueño la revise en la pantalla de revisión.
UPDATE "items" SET "kind" = 'product' WHERE "stock" > 0;--> statement-breakpoint

-- Rol sin privilegios con el que se ejecutan las consultas de citas (SET LOCAL ROLE dentro de la transacción del negocio).
-- (Los roles son del servidor entero, no de cada base: si dos bases se migran a la vez, la segunda encuentra el rol ya creado.)
DO $$ BEGIN CREATE ROLE xiro_app NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;--> statement-breakpoint
-- El usuario con el que corre la API debe poder hacer SET ROLE xiro_app (un superusuario ya puede; los demás necesitan esta pertenencia).
DO $$ BEGIN IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN EXECUTE format('GRANT xiro_app TO %I', current_user); END IF; END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO xiro_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "business_public_profiles", "business_settings", "business_closures", "employee_profiles", "employee_schedules", "employee_time_off", "employee_services", "service_variants", "service_packages", "service_package_entries", "appointments", "appointment_items", "appointment_events", "reviews" TO xiro_app;--> statement-breakpoint
-- Lo que las consultas de citas leen de las tablas existentes (sin RLS: siguen filtradas por business_id en el código).
GRANT SELECT ON "businesses", "users", "items", "item_photos", "categories" TO xiro_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "clients" TO xiro_app;--> statement-breakpoint

-- Row Level Security: PostgreSQL rechaza leer o escribir filas de otro negocio aunque una consulta olvide el filtro.
-- El negocio activo se fija por transacción con set_config('app.business_id', ...). Sin él, no se ve ni se escribe nada.
ALTER TABLE "business_public_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "business_public_profiles_tenant" ON "business_public_profiles" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "business_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "business_settings_tenant" ON "business_settings" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "business_closures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "business_closures_tenant" ON "business_closures" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "employee_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "employee_profiles_tenant" ON "employee_profiles" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "employee_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "employee_schedules_tenant" ON "employee_schedules" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "employee_time_off" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "employee_time_off_tenant" ON "employee_time_off" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "employee_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "employee_services_tenant" ON "employee_services" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "service_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "service_variants_tenant" ON "service_variants" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "service_packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "service_packages_tenant" ON "service_packages" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "service_package_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "service_package_entries_tenant" ON "service_package_entries" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "appointments_tenant" ON "appointments" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "appointment_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "appointment_items_tenant" ON "appointment_items" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "appointment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "appointment_events_tenant" ON "appointment_events" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "reviews_tenant" ON "reviews" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);
