-- Reversión de 0030_waitlist (lista de espera). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
--
-- Borra las esperas (no toca citas ni clientes). Exportarlas antes si se quieren conservar:
--   psql "$DATABASE_URL" -c "\copy (select * from waitlist_entries) to 'lista-espera.csv' csv header"
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0030_waitlist.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0030.dump

BEGIN;

DROP TABLE IF EXISTS "waitlist_entries";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791855209496;

COMMIT;
