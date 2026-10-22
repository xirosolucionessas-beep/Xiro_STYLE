-- Sonido de notificación de Xiro (ver docs/notification-sound.md). Migración ADITIVA: una columna con valor por defecto en
-- "push_tokens". Todos los dispositivos ya registrados quedan en false = reciben los avisos exactamente como antes; solo los
-- builds nuevos (que incluyen el sonido y su canal de Android) se registran con true. Reversión:
-- drizzle/rollback/0038_notification_sound.down.sql
--
-- PRODUCCIÓN: ADD COLUMN con DEFAULT constante no reescribe la tabla (PostgreSQL 11+).
ALTER TABLE "push_tokens" ADD COLUMN "custom_sound" boolean DEFAULT false NOT NULL;
