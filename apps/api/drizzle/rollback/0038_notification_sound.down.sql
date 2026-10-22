-- Reversión de 0038_notification_sound. NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- Efecto: todos los dispositivos vuelven a recibir los avisos sin el sonido de Xiro. Despliega antes una versión de la API
-- anterior a este cambio (la actual escribe y lee custom_sound).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0038_notification_sound.down.sql

BEGIN;

ALTER TABLE "push_tokens" DROP COLUMN IF EXISTS "custom_sound";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792376672812;

COMMIT;
