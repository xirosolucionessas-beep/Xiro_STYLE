-- Reversión de 0035_service_records_rls (RLS + lectura de service_records para xiro_app). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- No borra datos. Después de revertir, el Balance general debe volver a usar `withBusinessTrusted` (src/routes/balance.ts):
-- con el rol restringido y sin este permiso, el balance respondería "permission denied for table service_records".
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0035_service_records_rls.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0035.dump

BEGIN;

REVOKE SELECT ON "service_records" FROM xiro_app;
DROP POLICY IF EXISTS "service_records_tenant" ON "service_records";
ALTER TABLE "service_records" DISABLE ROW LEVEL SECURITY;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791948698171;

COMMIT;
