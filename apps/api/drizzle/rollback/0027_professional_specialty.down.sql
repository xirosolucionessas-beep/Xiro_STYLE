-- Reversión de 0027_professional_specialty (especialidad de cada profesional en la página pública). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
--
-- Solo quita la columna: se pierde la especialidad que cada negocio escribió (exportarla antes si se quiere conservar):
--   psql "$DATABASE_URL" -c "\copy (select user_id, business_id, specialty from employee_profiles) to 'especialidades.csv' csv header"
-- La calificación por profesional no usa columnas propias (se calcula de las reseñas), así que no hay nada más que revertir.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0027_professional_specialty.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0027.dump

BEGIN;

ALTER TABLE "employee_profiles" DROP COLUMN IF EXISTS "specialty";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791853417178;

COMMIT;
