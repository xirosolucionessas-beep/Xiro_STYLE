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

describe('migración 0039 (programa de cumpleaños)', () => {
  it('es aditiva: ningún cliente queda con fecha y ningún negocio con el programa activo; la reversión la quita y se vuelve a aplicar', async () => {
    const q = (text: string) => testDb.pool.query(text).then((r) => r.rows);
    const [biz] = await q(`insert into businesses (name, slug, type, hours) values ('Cumple', 'antes-del-cumple', 'barbershop', '{}'::jsonb) returning id`);
    await q(`insert into clients (business_id, name) values ('${biz.id}', 'Cliente de antes')`);
    expect(await q(`select birth_date from clients where business_id = '${biz.id}'`)).toEqual([{ birth_date: null }]);
    expect(await q(`select count(*)::int as n from birthday_programs`)).toEqual([{ n: 0 }]);

    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0039_birthday_program.down.sql'), 'utf8'));
    expect((await q(`select column_name from information_schema.columns where table_name = 'clients'`)).map((r) => r.column_name)).not.toContain('birth_date');
    expect(await q(`select table_name from information_schema.tables where table_name like 'birthday_%'`)).toEqual([]);
    expect(await q(`select name from clients where business_id = '${biz.id}'`)).toEqual([{ name: 'Cliente de antes' }]);

    await runMigrations(testDb);
    expect(await q(`select birth_date from clients where business_id = '${biz.id}'`)).toEqual([{ birth_date: null }]);
  });
});

describe('migración 0038 (sonido de notificación)', () => {
  it('es aditiva: los dispositivos ya registrados quedan SIN sonido personalizado; la reversión la quita y se puede volver a aplicar', async () => {
    const q = (text: string) => testDb.pool.query(text).then((r) => r.rows);
    const [biz] = await q(`insert into businesses (name, slug, type, hours) values ('Sonido', 'antes-del-sonido', 'barbershop', '{}'::jsonb) returning id`);
    const [user] = await q(`insert into users (business_id, name, email, password_hash) values ('${biz.id}', 'Dueña', 'sonido-0038@correo.com', 'x') returning id`);
    await q(`insert into push_tokens (business_id, user_id, platform, token) values ('${biz.id}', '${user.id}', 'expo', 'ExponentPushToken[antes]')`);
    expect(await q(`select custom_sound from push_tokens where token = 'ExponentPushToken[antes]'`)).toEqual([{ custom_sound: false }]);

    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0039_birthday_program.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0038_notification_sound.down.sql'), 'utf8'));
    expect((await q(`select column_name from information_schema.columns where table_name = 'push_tokens'`)).map((r) => r.column_name)).not.toContain('custom_sound');
    expect(await q(`select token from push_tokens where token = 'ExponentPushToken[antes]'`)).toHaveLength(1);

    await runMigrations(testDb);
    expect(await q(`select custom_sound from push_tokens where token = 'ExponentPushToken[antes]'`)).toEqual([{ custom_sound: false }]);
  });
});

describe('migración 0037 (panel de plataforma)', () => {
  it('es aditiva: los negocios existentes quedan activos; la reversión la quita sin tocar negocios y se puede volver a aplicar', async () => {
    const q = (text: string) => testDb.pool.query(text).then((r) => r.rows);
    await q(`insert into businesses (name, slug, type, hours) values ('Antes', 'antes-del-panel', 'barbershop', '{}'::jsonb)`);
    expect(await q(`select access_status from businesses where slug = 'antes-del-panel'`)).toEqual([{ access_status: 'active' }]);

    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0039_birthday_program.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0038_notification_sound.down.sql'), 'utf8')); // lo posterior a 0037 se revierte antes
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
