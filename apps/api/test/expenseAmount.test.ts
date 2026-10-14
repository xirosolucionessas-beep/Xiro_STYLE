import type { AuthSession, ExpenseDto } from '@xiro/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, register } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Monto del gasto en la API y en la base: pesos enteros de 1 a 1.000.000.000 (decisión del producto). Los mismos límites en
 * el alta y en la edición, con mensajes que la interfaz traduce; y la base los impone aunque alguien se salte la API.
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
let owner: AuthSession;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
  owner = await register(app, 'Montos');
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>) => app.inject({ method, url, headers: auth(owner), payload: payload as InjectOptions['payload'] });
const body = (amount: unknown) => ({ amount, description: 'Insumos', method: 'bank_transfer' });
const amountIssue = (res: { json: () => { issues?: Array<{ path: string; message: string }> } }) => res.json().issues?.find((i) => i.path === 'amount')?.message;

const cases: Array<[unknown, number, string | null]> = [
  [1, 0, null],
  [1_000_000_000, 0, null],
  [0, 400, 'expense_amount_min'],
  [-5, 400, 'expense_amount_min'],
  [1.5, 400, 'expense_amount_integer'],
  [1_000_000_001, 400, 'expense_amount_max'],
  ['5000', 400, 'expense_amount_required'],
  [null, 400, 'expense_amount_required'],
];

describe('monto en la API', () => {
  it('alta: límites exactos aceptados; cero, negativos, decimales, texto y más del máximo rechazados con su mensaje', async () => {
    for (const [amount, status, issue] of cases) {
      const res = await send('POST', '/api/expenses', body(amount));
      if (issue === null) expect(res.statusCode, JSON.stringify(amount)).toBe(201);
      else {
        expect(res.statusCode, JSON.stringify(amount)).toBe(status);
        expect(amountIssue(res), JSON.stringify(amount)).toBe(issue);
      }
    }
  });

  it('edición: las mismas reglas', async () => {
    const created = (await send('POST', '/api/expenses', body(5000))).json<ExpenseDto>();
    for (const [amount, status, issue] of cases) {
      const res = await send('PUT', `/api/expenses/${created.id}`, body(amount));
      if (issue === null) expect(res.statusCode, JSON.stringify(amount)).toBe(200);
      else {
        expect(res.statusCode, JSON.stringify(amount)).toBe(status);
        expect(amountIssue(res), JSON.stringify(amount)).toBe(issue);
      }
    }
  });
});

describe('monto en la base de datos', () => {
  it('la restricción expenses_amount_ck rechaza 0 y más de 1.000.000.000 aunque se escriba directo (y acepta los límites)', async () => {
    const insert = (amount: number) =>
      testDb.pool.query('insert into expenses (business_id, amount, description, created_by) values ($1, $2, $3, $4)', [owner.business.id, amount, 'Directo', owner.user.id]);
    await expect(insert(0)).rejects.toThrow(/expenses_amount_ck/);
    await expect(insert(1_000_000_001)).rejects.toThrow(/expenses_amount_ck/);
    await expect(insert(1)).resolves.toBeTruthy();
    await expect(insert(1_000_000_000)).resolves.toBeTruthy();
    // Y la columna es entera: un decimal no se guarda como tal.
    const { rows } = await testDb.pool.query("select data_type from information_schema.columns where table_name = 'expenses' and column_name = 'amount'");
    expect(rows[0].data_type).toBe('integer');
  });
});
