-- Reversión de 0033_finance_expenses (módulo Finanzas sobre la tabla de gastos). NO la ejecuta el migrador.
-- ORDEN: si ya se aplicaron migraciones posteriores, revertirlas ANTES, de la más nueva a la más vieja.
-- Quita solo las columnas nuevas: los gastos (monto, concepto, método, creador, fecha de creación) se conservan.
-- OJO: los gastos ANULADOS volverían a contar como vigentes y se pierden tipo, categoría, empleado y notas. Exportar antes:
--   psql "$DATABASE_URL" -c "\copy (select * from expenses) to 'gastos.csv' csv header"
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0033_finance_expenses.down.sql
--
-- Respaldo previo (siempre): pg_dump "$DATABASE_URL" --format=custom --file=respaldo-antes-0033.dump

BEGIN;

REVOKE SELECT ON "cash_openings" FROM xiro_app;
DROP POLICY IF EXISTS "cash_openings_tenant" ON "cash_openings";
ALTER TABLE "cash_openings" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_cash_method_ck";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_payroll_employee_ck";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_status_ck";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_type_ck";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_voided_by_fk";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_employee_fk";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_cash_opening_id_cash_openings_id_fk";
DROP INDEX IF EXISTS "expenses_business_employee_idx";
DROP INDEX IF EXISTS "expenses_business_date_idx";
ALTER TABLE "expenses"
  DROP COLUMN IF EXISTS "updated_at",
  DROP COLUMN IF EXISTS "voided_at",
  DROP COLUMN IF EXISTS "voided_by",
  DROP COLUMN IF EXISTS "void_reason",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "cash_opening_id",
  DROP COLUMN IF EXISTS "paid_from_cash",
  DROP COLUMN IF EXISTS "notes",
  DROP COLUMN IF EXISTS "employee_id",
  DROP COLUMN IF EXISTS "expense_date",
  DROP COLUMN IF EXISTS "category",
  DROP COLUMN IF EXISTS "type";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791880377116;

COMMIT;
