-- Segunda barrera para el Balance general (auditoría de seguridad, fase 4): `service_records` (lo cobrado por servicios y
-- productos) pasa a tener aislamiento por negocio con Row Level Security, como el resto de tablas de un negocio, y el rol
-- restringido `xiro_app` puede LEERLA (solo leer). Así el balance corre con `withBusiness` (rol restringido + RLS): aunque una
-- consulta olvidara filtrar por negocio, la base no devolvería filas de otro.
--
-- No cambia nada para el resto del código: las rutas que hoy escriben o leen `service_records` lo hacen con el rol dueño de
-- la tabla (conexión directa o `withBusinessTrusted`), que no está sujeto a RLS (no se usa FORCE ROW LEVEL SECURITY).
-- Reversión: drizzle/rollback/0035_service_records_rls.down.sql
ALTER TABLE "service_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "service_records_tenant" ON "service_records" AS PERMISSIVE FOR SELECT TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON "service_records" TO xiro_app;
