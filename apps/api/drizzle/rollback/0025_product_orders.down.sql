-- Reversión de 0025_product_orders (pedidos de solo productos). NO la ejecuta el migrador: es manual.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
--
-- ATENCIÓN: borra los pedidos de productos y sus líneas. Las ventas con las que se entregaron NO se tocan (son ventas
-- normales, con su inventario ya descontado). Las citas, clientes y catálogo no se tocan. Exportar antes los pedidos
-- si se quieren conservar:
--   psql "$DATABASE_URL" -c "\copy (select * from product_orders) to 'pedidos.csv' csv header"
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0025_product_orders.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0025.dump

BEGIN;

DROP TRIGGER IF EXISTS product_orders_notify_trigger ON "product_orders";
DROP FUNCTION IF EXISTS product_orders_notify();
DROP TABLE IF EXISTS "product_order_items";
DROP TABLE IF EXISTS "product_orders";
ALTER TABLE "business_settings" DROP COLUMN IF EXISTS "product_orders_enabled";
-- Para que el migrador no la crea aplicada (si se vuelve a desplegar el código con 0025, se aplica de nuevo):
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791837860387;

COMMIT;
