ALTER TABLE "expenses" ADD COLUMN "type" text DEFAULT 'operating' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "expense_date" date DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paid_from_cash" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "cash_opening_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "void_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_opening_id_cash_openings_id_fk" FOREIGN KEY ("cash_opening_id") REFERENCES "public"."cash_openings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_employee_fk" FOREIGN KEY ("employee_id","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_fk" FOREIGN KEY ("voided_by","business_id") REFERENCES "public"."users"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_business_date_idx" ON "expenses" USING btree ("business_id","expense_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expenses_business_employee_idx" ON "expenses" USING btree ("business_id","employee_id") WHERE "expenses"."employee_id" is not null;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_type_ck" CHECK ("expenses"."type" in ('operating','payroll'));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_status_ck" CHECK ("expenses"."status" in ('active','voided'));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payroll_employee_ck" CHECK ("expenses"."type" <> 'payroll' or "expenses"."employee_id" is not null);--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_method_ck" CHECK (not "expenses"."paid_from_cash" or "expenses"."method" = 'cash');--> statement-breakpoint
-- Gastos ya existentes: fecha = su día de creación en la zona del negocio; en efectivo = pagados desde la caja de ese día
-- (así se descontaban siempre del arqueo), enlazados a la apertura de ese día si la hubo. El arqueo de días pasados no cambia.
UPDATE "expenses" AS e
SET "expense_date" = (e."created_at" AT TIME ZONE b."timezone")::date,
    "paid_from_cash" = (e."method" = 'cash'),
    "cash_opening_id" = CASE WHEN e."method" = 'cash' THEN (
      SELECT o."id" FROM "cash_openings" o
      WHERE o."business_id" = e."business_id" AND o."day" = (e."created_at" AT TIME ZONE b."timezone")::date
      LIMIT 1
    ) END
FROM "businesses" AS b
WHERE b."id" = e."business_id";
--> statement-breakpoint
-- Los gastos (con RLS, rol xiro_app) consultan la apertura del día: la tabla recibe la MISMA protección por negocio que
-- cash_closings y expenses. Solo lectura para xiro_app; las consultas actuales de Caja (dueño de la tabla) no cambian.
ALTER TABLE "cash_openings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cash_openings_tenant" ON "cash_openings" AS PERMISSIVE FOR ALL TO xiro_app USING ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON "cash_openings" TO xiro_app;
