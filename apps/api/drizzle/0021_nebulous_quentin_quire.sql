ALTER TABLE "notifications" DROP CONSTRAINT "notifications_category_ck";--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "clients_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "sales_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "inventory_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "employees_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "security_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_category_ck" CHECK ("notifications"."category" in ('appointments','reviews','loyalty','billing','clients','sales','inventory','employees','security'));