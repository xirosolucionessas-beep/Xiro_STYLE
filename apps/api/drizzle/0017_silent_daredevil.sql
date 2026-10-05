ALTER TABLE "service_records" ADD COLUMN "kind" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_records" ADD COLUMN "voided" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Relleno de datos históricos: 'service' por defecto ya es correcto para los registros manuales (única puerta antes de
-- esta columna) y para los que perdieron su enlace a catálogo; aquí solo se corrigen los que SÍ apuntan a un producto.
UPDATE "service_records" sr SET "kind" = 'product' FROM "items" i WHERE sr."item_id" = i."id" AND i."kind" = 'product';--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_kind_ck" CHECK ("service_records"."kind" in ('service','product'));