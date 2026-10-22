import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import { auth, register } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Migración 0033 (módulo Finanzas) sobre gastos YA existentes: se revierte, se insertan gastos con el formato anterior y se
 * vuelve a migrar. Fecha = día de creación en Bogotá (también a las 11:30 p. m.), efectivo = desde caja enlazado a la apertura
 * de ese día, y el arqueo de ese día da exactamente lo mismo antes y después.
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanup: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const created = testAppConfig();
  cleanup = created.cleanup;
  app = await buildApp({ db: testDb.db, config: created.config });
});

afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

describe('migración 0033 sobre gastos existentes', () => {
  it('rellena fecha, "desde caja" y apertura; el esperado de caja no cambia; la reversión deja el formato anterior', async () => {
    const session = await register(app, 'Migración gastos');
    const businessId = session.business.id;
    const day = '2026-05-10';
    // Volvemos al esquema anterior a Finanzas: primero lo posterior (0037 panel de plataforma, 0036 índices, 0035 RLS de registros,
    // 0034 ajustes), luego 0033.
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0039_birthday_program.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0038_notification_sound.down.sql'), 'utf8')); // lo posterior a 0037 se revierte antes
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0037_platform_admin.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0036_finance_covering_indexes.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0035_service_records_rls.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0034_expense_adjustments.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0033_finance_expenses.down.sql'), 'utf8'));
    const cols = (await testDb.pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'expenses'")).rows.map((r) => r.column_name);
    expect(cols).not.toContain('expense_date');

    // Datos con el formato anterior: una apertura ese día y tres gastos (uno a las 11:30 p. m. hora Bogotá = 04:30 UTC del día siguiente).
    await testDb.pool.query('insert into cash_openings (business_id, day, amount) values ($1, $2, 100000)', [businessId, day]);
    const insert = (amount: number, method: string, at: string) =>
      testDb.pool.query('insert into expenses (business_id, amount, description, method, created_by, created_at) values ($1, $2, $3, $4, $5, $6)', [businessId, amount, `Gasto ${amount}`, method, session.user.id, at]);
    await insert(10000, 'cash', '2026-05-10T15:00:00.000Z');
    await insert(2500, 'cash', '2026-05-11T04:30:00.000Z'); // 10 de mayo, 11:30 p. m. en Bogotá
    await insert(40000, 'bank_transfer', '2026-05-10T18:00:00.000Z');

    await runMigrations(testDb);

    const rows = (await testDb.pool.query<{ amount: number; expense_date: string; paid_from_cash: boolean; cash_opening_id: string | null; type: string; category: string; status: string }>(
      "select amount, to_char(expense_date, 'YYYY-MM-DD') as expense_date, paid_from_cash, cash_opening_id, type, category, status from expenses where business_id = $1 order by amount",
      [businessId],
    )).rows;
    expect(rows.map((r) => [r.amount, r.expense_date, r.paid_from_cash, r.cash_opening_id !== null])).toEqual([
      [2500, day, true, true],
      [10000, day, true, true],
      [40000, day, false, false],
    ]);
    expect(rows.every((r) => r.type === 'operating' && r.category === 'other' && r.status === 'active')).toBe(true);

    // El arqueo de ese día: 100.000 de apertura − 12.500 en efectivo (la transferencia no sale de la caja), igual que antes.
    const summary = (await app.inject({ method: 'GET', url: `/api/cash/close-summary?day=${day}`, headers: auth(session) })).json<{ expectedCash: number; totalExpenses: number }>();
    expect(summary).toMatchObject({ expectedCash: 87500, totalExpenses: 52500 });
  });
});
