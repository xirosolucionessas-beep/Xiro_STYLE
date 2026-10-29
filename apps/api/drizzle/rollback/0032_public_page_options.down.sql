-- Reversión de 0032_public_page_options (distintivo "sin pago anticipado" y campo de comentarios). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- Solo quita dos opciones de la página pública; las notas ya guardadas en las citas NO se tocan.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0032_public_page_options.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0032.dump

BEGIN;

ALTER TABLE "business_settings" DROP COLUMN IF EXISTS "no_prepay_badge_enabled";
ALTER TABLE "business_settings" DROP COLUMN IF EXISTS "customer_notes_enabled";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791875480690;

COMMIT;
