import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate';
import { createTestDatabase, type TestDatabase } from './helpers/db';

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => testDb.drop());

describe('migración 0037 (panel de plataforma)', () => {
  it('es aditiva: los negocios existentes quedan activos; la reversión la quita sin tocar negocios y se puede volver a aplicar', async () => {
    const q = (text: string) => testDb.pool.query(text).then((r) => r.rows);
    await q(`insert into businesses (name, slug, type, hours) values ('Antes', 'antes-del-panel', 'barbershop', '{}'::jsonb)`);
    expect(await q(`select access_status from businesses where slug = 'antes-del-panel'`)).toEqual([{ access_status: 'active' }]);

    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0037_platform_admin.down.sql'), 'utf8'));
    const tables = (await q(`select table_name from information_schema.tables where table_name like 'platform_%' or table_name = 'business_access_grants'`)).map((r) => r.table_name);
    expect(tables).toEqual([]);
    const cols = (await q(`select column_name from information_schema.columns where table_name = 'businesses'`)).map((r) => r.column_name);
    expect(cols).not.toContain('access_status');
    expect(await q(`select name from businesses where slug = 'antes-del-panel'`)).toEqual([{ name: 'Antes' }]);

    await runMigrations(testDb);
    expect(await q(`select access_status from businesses where slug = 'antes-del-panel'`)).toEqual([{ access_status: 'active' }]);
    expect((await q(`select count(*)::int as n from information_schema.tables where table_name = 'platform_audit_log'`))[0]).toEqual({ n: 1 });
  });
});
