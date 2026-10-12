-- Reversión de 0024_search_and_tenant_indexes (Fase 2, punto 10). NO la ejecuta el migrador: es manual.
-- ORDEN: si ya se aplicaron migraciones posteriores (0025…), revertirlas ANTES, de la más nueva a la más vieja.
--
-- La migración 0024 solo agrega índices y extensiones; no toca datos. Revertirla solo quita esos índices:
-- las consultas siguen funcionando igual (más lentas en negocios grandes). Seguro de ejecutar más de una vez.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0024_search_and_tenant_indexes.down.sql
--
-- Antes de aplicar 0024 en producción (o de revertirla), respaldo:
--   pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0024.dump
-- Restaurar ese respaldo, si hiciera falta:
--   pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" respaldo-antes-0024.dump

BEGIN;

DROP INDEX IF EXISTS "clients_search_trgm_idx";
DROP INDEX IF EXISTS "clients_business_created_idx";
DROP INDEX IF EXISTS "clients_business_phone_idx";
DROP INDEX IF EXISTS "items_search_trgm_idx";
DROP INDEX IF EXISTS "loyalty_redemptions_business_idx";

-- Saca la 0024 del registro del migrador para que `npm run db:migrate` pueda volver a aplicarla después.
-- (Drizzle guarda cada migración aplicada con su `created_at` = el "when" de drizzle/meta/_journal.json.)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791747598142;

COMMIT;

-- Las extensiones pg_trgm y btree_gin se dejan instaladas a propósito: no ocupan espacio ni cambian nada por sí
-- solas, y quitarlas podría romper otros objetos que las usen. Solo si se quiere dejar la base exactamente como antes:
--   DROP EXTENSION IF EXISTS btree_gin;
--   DROP EXTENSION IF EXISTS pg_trgm;
