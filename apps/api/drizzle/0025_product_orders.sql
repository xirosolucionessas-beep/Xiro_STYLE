CREATE TABLE "product_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "product_order_items_qty_ck" CHECK ("product_order_items"."quantity" between 1 and 20),
	CONSTRAINT "product_order_items_price_ck" CHECK ("product_order_items"."unit_price" between 0 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "product_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"client_account_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"customer_notes" text DEFAULT '' NOT NULL,
	"total_price" integer NOT NULL,
	"idempotency_hash" text,
	"terms_accepted_at" timestamp with time zone,
	"terms_accepted_ip" text,
	"sale_id" uuid,
	"cancel_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_orders_id_business_uq" UNIQUE("id","business_id"),
	CONSTRAINT "product_orders_status_ck" CHECK ("product_orders"."status" in ('pending','ready','delivered','cancelled')),
	CONSTRAINT "product_orders_total_ck" CHECK ("product_orders"."total_price" between 0 and 1000000000),
	CONSTRAINT "product_orders_delivered_sale_ck" CHECK ("product_orders"."status" <> 'delivered' or "product_orders"."sale_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "product_orders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_order_items" ADD CONSTRAINT "product_order_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_order_items" ADD CONSTRAINT "product_order_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_order_items" ADD CONSTRAINT "product_order_items_order_fk" FOREIGN KEY ("order_id","business_id") REFERENCES "public"."product_orders"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_client_business_fk" FOREIGN KEY ("client_id","business_id") REFERENCES "public"."clients"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_order_items_order_idx" ON "product_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_orders_idem_uq" ON "product_orders" USING btree ("business_id","idempotency_hash") WHERE "product_orders"."idempotency_hash" is not null;--> statement-breakpoint
CREATE INDEX "product_orders_business_created_idx" ON "product_orders" USING btree ("business_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_orders_business_status_idx" ON "product_orders" USING btree ("business_id","status");--> statement-breakpoint
-- Aislamiento por negocio en la propia base (igual que las citas, ver 0006): con el rol restringido de la aplicación solo se
-- ven y se escriben filas del negocio activo (`app.business_id`), aunque una consulta olvidara filtrar.
GRANT SELECT, INSERT, UPDATE ON "product_orders", "product_order_items" TO xiro_app;--> statement-breakpoint
ALTER TABLE "product_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "product_orders_tenant" ON "product_orders" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "product_order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "product_order_items_tenant" ON "product_order_items" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
-- Aviso en tiempo real al panel del negocio (mismo canal que las citas, con `kind`). Solo lleva el id del negocio: quien
-- escucha vuelve a pedir por la API, que filtra por sesión. Nunca datos del pedido ni del cliente.
CREATE OR REPLACE FUNCTION product_orders_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('appointments_changed', json_build_object('businessId', COALESCE(NEW.business_id, OLD.business_id), 'kind', 'orders')::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS product_orders_notify_trigger ON "product_orders";--> statement-breakpoint
CREATE TRIGGER product_orders_notify_trigger
AFTER INSERT OR UPDATE OR DELETE ON "product_orders"
FOR EACH ROW EXECUTE FUNCTION product_orders_notify();
