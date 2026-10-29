-- Reversión de 0036_finance_covering_indexes (índices de cobertura del Balance general). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- No borra datos: solo los dos índices. El balance sigue funcionando igual (más lento en rangos de muchos meses).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0036_finance_covering_indexes.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0036.dump

BEGIN;

DROP INDEX IF EXISTS "service_records_balance_idx";
DROP INDEX IF EXISTS "sales_balance_idx";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791999234151;

COMMIT;
