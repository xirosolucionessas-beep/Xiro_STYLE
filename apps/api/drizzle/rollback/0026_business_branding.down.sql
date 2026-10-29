-- Reversión de 0026_business_branding (marca del negocio en su página: acento, título, avisos). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
--
-- Solo quita las tres columnas nuevas: la página vuelve al tema dorado y al título por defecto. No toca ningún otro dato.
-- Se pierde lo que cada negocio configuró en ellas; exportarlo antes si se quiere conservar:
--   psql "$DATABASE_URL" -c "\copy (select business_id, accent_color, booking_title, trust_badges from business_public_profiles) to 'marca.csv' csv header"
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0026_business_branding.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0026.dump

BEGIN;

ALTER TABLE "business_public_profiles" DROP CONSTRAINT IF EXISTS "bpp_accent_ck";
ALTER TABLE "business_public_profiles" DROP COLUMN IF EXISTS "trust_badges";
ALTER TABLE "business_public_profiles" DROP COLUMN IF EXISTS "booking_title";
ALTER TABLE "business_public_profiles" DROP COLUMN IF EXISTS "accent_color";
-- Para que el migrador no la crea aplicada (si se vuelve a desplegar el código con 0026, se aplica de nuevo):
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791842862825;

COMMIT;
