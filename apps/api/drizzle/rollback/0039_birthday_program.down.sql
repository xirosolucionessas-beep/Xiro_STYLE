-- Reversión de 0039_birthday_program. NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- BORRA la configuración de cumpleaños de todos los negocios, las recompensas emitidas y las fechas de nacimiento de los
-- clientes. Respáldalas antes si las necesitas. Despliega primero una versión de la API anterior al programa de cumpleaños.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0039_birthday_program.down.sql

BEGIN;

DROP TABLE IF EXISTS "birthday_rewards";
DROP TABLE IF EXISTS "birthday_programs";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "birth_date";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792386006530;

COMMIT;
