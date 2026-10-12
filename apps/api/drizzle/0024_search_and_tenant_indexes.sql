-- Búsqueda "contiene" con trigramas (pg_trgm) y el negocio dentro del índice GIN (btree_gin), más índices de
-- listados por negocio. Solo AGREGA extensiones e índices: no modifica ni borra datos.
-- Reversión: drizzle/rollback/0024_search_and_tenant_indexes.down.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;--> statement-breakpoint
CREATE INDEX "clients_search_trgm_idx" ON "clients" USING gin ("business_id",("name" || ' ' || coalesce("email", '') || ' ' || coalesce("phone", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_business_created_idx" ON "clients" USING btree ("business_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "clients_business_phone_idx" ON "clients" USING btree ("business_id","phone");--> statement-breakpoint
CREATE INDEX "items_search_trgm_idx" ON "items" USING gin ("business_id",(translate(lower("name" || ' ' || "reference_code"), 'áàâäãéèêëíìîïóòôöõúùûüñç', 'aaaaaeeeeiiiiooooouuuunc')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "loyalty_redemptions_business_idx" ON "loyalty_redemptions" USING btree ("business_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);