-- Segunda barrera para catálogo y clientes (auditoría de seguridad): `items`, `item_photos`, `categories` y `clients`
-- pasan a tener Row Level Security para el rol restringido `xiro_app`, igual que `service_records` en 0035. `xiro_app`
-- ya tenía estos GRANT desde 0006 (los usa el módulo de citas, que corre con `withBusiness` — rol restringido + RLS —
-- para leer el catálogo/clientes del negocio y crear clientes "de mostrador" al reservar). Hasta ahora esos permisos
-- no tenían ninguna política: sin RLS, un GRANT por sí solo no limita nada por negocio, así que esas consultas (ya
-- siempre filtradas por business_id en el código, verificado en src/booking/catalog.ts y src/booking/appointments.ts)
-- quedaban sin la segunda barrera que sí tienen appointments/messages/etc. desde 0006.
--
-- No cambia nada para el resto del código: las rutas de catálogo/clientes del panel (routes/clients.ts, catalog.ts,
-- inventory.ts) siguen leyendo/escribiendo con el rol dueño de la tabla (conexión directa), que no está sujeto a RLS
-- (no se usa FORCE ROW LEVEL SECURITY). Esta migración NO las protege — ese es un cambio más grande y deliberadamente
-- fuera de alcance aquí (requeriría migrar esas rutas a `withBusiness`, con su propio análisis y pruebas).
-- Reversión: drizzle/rollback/0040_catalog_clients_rls.down.sql
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "items_tenant" ON "items" AS PERMISSIVE FOR SELECT TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint

-- item_photos no tiene su propia business_id: se vincula al negocio a través de item_id -> items.business_id.
ALTER TABLE "item_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "item_photos_tenant" ON "item_photos" AS PERMISSIVE FOR SELECT TO xiro_app USING (EXISTS (SELECT 1 FROM "items" WHERE "items"."id" = "item_photos"."item_id" AND "items"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid));--> statement-breakpoint

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "categories_tenant" ON "categories" AS PERMISSIVE FOR SELECT TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "clients_tenant" ON "clients" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);
