-- Reversión de 0028_phase4_feature_flags (interruptores de la Fase 4 por negocio). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores (0029…), revertirlas ANTES, de la más nueva a la más vieja.
--
-- Solo quita los interruptores: los recordatorios vuelven al de siempre (3 h antes) y las funciones de la Fase 4 se apagan.
-- No toca citas, clientes ni ventas.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0028_phase4_feature_flags.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0028.dump

BEGIN;

ALTER TABLE "business_settings" DROP COLUMN IF EXISTS "remember_customer_enabled";
ALTER TABLE "business_settings" DROP COLUMN IF EXISTS "review_requests_enabled";
ALTER TABLE "business_settings" DROP COLUMN IF EXISTS "discount_codes_enabled";
ALTER TABLE "business_settings" DROP COLUMN IF EXISTS "waitlist_enabled";
ALTER TABLE "business_settings" DROP COLUMN IF EXISTS "reminder_hours";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791854351800;

COMMIT;
