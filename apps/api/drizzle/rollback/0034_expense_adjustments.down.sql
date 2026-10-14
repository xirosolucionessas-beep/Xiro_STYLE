-- Reversión de 0034_expense_adjustments (ajustes a gastos de una caja ya cerrada). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- Borra el historial de ajustes (los gastos y sus valores actuales se conservan). Exportarlo antes si se quiere guardar:
--   psql "$DATABASE_URL" -c "\copy (select * from expense_adjustments) to 'ajustes-gastos.csv' csv header"
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0034_expense_adjustments.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0034.dump

BEGIN;

DROP TABLE IF EXISTS "expense_adjustments";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791881844172;

COMMIT;
