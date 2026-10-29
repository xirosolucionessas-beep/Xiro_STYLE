-- Panel del fundador / administración de la plataforma (ver docs/platform-admin.md). Migración ADITIVA: solo crea tablas
-- nuevas, dos columnas con valor por defecto en "businesses" (todo negocio existente queda 'active', igual que hoy) y un
-- índice. No borra ni reescribe datos. Reversión: drizzle/rollback/0037_platform_admin.down.sql
--
-- PRODUCCIÓN: ADD COLUMN con DEFAULT constante no reescribe la tabla (PostgreSQL 11+). CREATE INDEX "businesses_created_idx"
-- bloquea las escrituras de "businesses" mientras se construye (una fila por negocio: milisegundos con miles de negocios).
CREATE TABLE "business_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"amount" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"support_ref" text,
	"idempotency_key" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_grants_unit_ck" CHECK ("business_access_grants"."unit" in ('days','months')),
	CONSTRAINT "access_grants_amount_ck" CHECK (("business_access_grants"."unit" = 'days' and "business_access_grants"."amount" between 1 and 366) or ("business_access_grants"."unit" = 'months' and "business_access_grants"."amount" between 1 and 24)),
	CONSTRAINT "access_grants_range_ck" CHECK ("business_access_grants"."ends_at" > "business_access_grants"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "platform_admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mfa_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text NOT NULL,
	"totp_last_step" integer DEFAULT 0 NOT NULL,
	"is_founder" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_lower_ck" CHECK ("platform_admins"."email" = lower("platform_admins"."email"))
);
--> statement-breakpoint
CREATE TABLE "platform_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"business_id" uuid,
	"outcome" text NOT NULL,
	"request_id" text,
	"ip" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_audit_outcome_ck" CHECK ("platform_audit_log"."outcome" in ('success','denied','error'))
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "access_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "access_status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_access_grants" ADD CONSTRAINT "business_access_grants_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_access_grants" ADD CONSTRAINT "business_access_grants_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_access_grants" ADD CONSTRAINT "business_access_grants_revoked_by_platform_admins_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_grants_idempotency_uq" ON "business_access_grants" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "access_grants_business_idx" ON "business_access_grants" USING btree ("business_id","ends_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "platform_sessions_token_uq" ON "platform_admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "platform_sessions_admin_idx" ON "platform_admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_email_uq" ON "platform_admins" USING btree ("email");--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "platform_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "platform_audit_business_idx" ON "platform_audit_log" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "platform_audit_admin_idx" ON "platform_audit_log" USING btree ("admin_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "businesses_created_idx" ON "businesses" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_access_status_ck" CHECK ("businesses"."access_status" in ('active','suspended','deactivated'));--> statement-breakpoint
-- Bitácora inmutable desde la aplicación: ni UPDATE, ni DELETE, ni TRUNCATE (también para el rol dueño de la tabla). Límite
-- conocido: un superusuario o el dueño de la tabla puede quitar el trigger; la protección es contra errores y flujos normales,
-- no contra quien administra el servidor de base de datos (para eso: respaldos y registros externos).
CREATE OR REPLACE FUNCTION platform_audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_log es de solo inserción';
END;
$$;--> statement-breakpoint
CREATE TRIGGER platform_audit_log_no_update BEFORE UPDATE OR DELETE ON "platform_audit_log" FOR EACH ROW EXECUTE FUNCTION platform_audit_log_immutable();--> statement-breakpoint
CREATE TRIGGER platform_audit_log_no_truncate BEFORE TRUNCATE ON "platform_audit_log" FOR EACH STATEMENT EXECUTE FUNCTION platform_audit_log_immutable();--> statement-breakpoint
-- El rol restringido de los negocios no ve nada de la plataforma (no tiene permisos por defecto, esto lo deja explícito).
REVOKE ALL ON "platform_admins", "platform_admin_sessions", "platform_audit_log", "business_access_grants" FROM xiro_app;
