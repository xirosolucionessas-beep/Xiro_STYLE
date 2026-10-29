-- Reversión de 0031_discount_fk_indexes (índices de la llave foránea al código de descuento). NO la ejecuta el migrador.
-- Solo quita índices: no toca ningún dato. Si hay migraciones posteriores, revertirlas ANTES (de la más nueva a la más vieja).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0031_discount_fk_indexes.down.sql

BEGIN;

DROP INDEX IF EXISTS "appointments_discount_code_idx";
DROP INDEX IF EXISTS "product_orders_discount_code_idx";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791858730653;

COMMIT;
