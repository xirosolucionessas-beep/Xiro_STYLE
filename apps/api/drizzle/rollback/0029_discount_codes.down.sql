-- Reversión de 0029_discount_codes (códigos de descuento). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
--
-- Borra los códigos y quita de citas y pedidos qué código usaron y cuánto descontó. El total bruto de cada cita y pedido NO
-- cambia (el descuento siempre se guardó aparte). Exportar antes lo que se quiera conservar:
--   psql "$DATABASE_URL" -c "\copy (select * from discount_codes) to 'codigos.csv' csv header"
--   psql "$DATABASE_URL" -c "\copy (select id, discount_code_id, discount_amount from appointments where discount_amount > 0) to 'citas-descuento.csv' csv header"
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0029_discount_codes.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0029.dump

BEGIN;

ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_discount_ck";
ALTER TABLE "product_orders" DROP CONSTRAINT IF EXISTS "product_orders_discount_ck";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "discount_amount";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "discount_code_id";
ALTER TABLE "product_orders" DROP COLUMN IF EXISTS "discount_amount";
ALTER TABLE "product_orders" DROP COLUMN IF EXISTS "discount_code_id";
DROP TABLE IF EXISTS "discount_codes";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791854612209;

COMMIT;
