-- Reversión de 0040_catalog_clients_rls (RLS sobre items/item_photos/categories/clients para xiro_app). NO la ejecuta
-- el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- No borra datos ni GRANT (esos vienen de 0006, anterior a esta migración).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0040_catalog_clients_rls.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0040.dump

BEGIN;

DROP POLICY IF EXISTS "clients_tenant" ON "clients";
ALTER TABLE "clients" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_tenant" ON "categories";
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_photos_tenant" ON "item_photos";
ALTER TABLE "item_photos" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "items_tenant" ON "items";
ALTER TABLE "items" DISABLE ROW LEVEL SECURITY;

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792724768877;

COMMIT;
