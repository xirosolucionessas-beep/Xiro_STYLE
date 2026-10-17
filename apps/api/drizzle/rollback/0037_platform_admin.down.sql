-- Reversión de 0037_platform_admin (panel de administración de la plataforma). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- BORRA las tablas del panel: administradores, sesiones, concesiones de acceso y la BITÁCORA de la plataforma. Haz un
-- respaldo primero y conserva la bitácora si la necesitas (pg_dump --table=platform_audit_log). Los negocios suspendidos o
-- desactivados vuelven a tener acceso (desaparece la columna access_status). Antes de revertir, despliega una versión de la
-- API anterior al panel: la versión actual lee access_status en cada petición.
--
--   pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0037.dump
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0037_platform_admin.down.sql

BEGIN;

DROP TABLE IF EXISTS "business_access_grants";
DROP TABLE IF EXISTS "platform_admin_sessions";
DROP TRIGGER IF EXISTS platform_audit_log_no_truncate ON "platform_audit_log";
DROP TRIGGER IF EXISTS platform_audit_log_no_update ON "platform_audit_log";
DROP TABLE IF EXISTS "platform_audit_log";
DROP FUNCTION IF EXISTS platform_audit_log_immutable();
DROP TABLE IF EXISTS "platform_admins";
DROP INDEX IF EXISTS "businesses_created_idx";
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_access_status_ck";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "access_status_changed_at";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "access_status";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792266615411;

COMMIT;
