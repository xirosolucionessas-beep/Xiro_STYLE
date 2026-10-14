import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/migrate';

/**
 * La migración de citas debe poder aplicarse sobre una base que YA tiene datos (negocios, artículos, clientes) sin perder
 * nada, y clasificar provisionalmente los artículos existentes.
 */
describe('migración 0006_citas sobre una base con datos', () => {
  const adminUrl = inject('pgAdminUrl');
  const name = `xiro_migr_${randomBytes(6).toString('hex')}`;
  let pool: pg.Pool;
  let previous: string;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });

    // Carpeta de migraciones "de antes": sin la de citas ni ninguna posterior. Se recorta por índice (no por nombre)
    // para que agregar una migración nueva más adelante (0008, 0009…) no vuelva a colar algo "del futuro" aquí: si se
    // cortara por prefijo fijo, una migración nueva con timestamp mayor que 0006/0007 quedaría en esta carpeta y
    // adelantaría el "reloj" de aplicadas de Drizzle, bloqueando que 0006/0007 se apliquen de verdad más abajo.
    previous = mkdtempSync(path.join(tmpdir(), 'xiro-migr-'));
    cpSync(MIGRATIONS_FOLDER, previous, { recursive: true });
    const journalPath = path.join(previous, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
    const citasIdx = journal.entries.findIndex((entry) => entry.tag === '0006_citas');
    const [kept, dropped] = [journal.entries.filter((e) => e.idx < citasIdx), journal.entries.filter((e) => e.idx >= citasIdx)];
    journal.entries = kept;
    writeFileSync(journalPath, JSON.stringify(journal));
    for (const entry of dropped) rmSync(path.join(previous, `${entry.tag}.sql`));
  });

  afterAll(async () => {
    await pool.end();
    rmSync(previous, { recursive: true, force: true });
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  it('conserva los datos existentes, clasifica por existencias y crea la protección por negocio', async () => {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: previous });

    const { rows: [business] } = await pool.query(`insert into businesses (name, slug, type, hours) values ('Vieja Barbería', 'vieja-barberia', 'barbershop', '{"sameEveryDay":true,"days":[]}') returning id`);
    const businessId = business.id as string;
    const { rows: [category] } = await pool.query(`insert into categories (business_id, name) values ($1, 'General') returning id`, [businessId]);
    await pool.query(`insert into items (business_id, category_id, name, price, stock, stock_status) values ($1, $2, 'Shampoo', 20000, 5, 'available'), ($1, $2, 'Corte', 30000, 0, 'out_of_stock')`, [businessId, category.id]);
    await pool.query(`insert into users (business_id, name, email, password_hash, role) values ($1, 'Dueño', 'viejo@correo.com', 'x', 'owner')`, [businessId]);
    await pool.query(`insert into clients (business_id, name, phone) values ($1, 'Cliente de siempre', '573001112233')`, [businessId]);

    // Ahora sí: aplicar TODAS (incluida la 0006) sobre esa base.
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const items = await pool.query(`select name, kind, kind_confirmed, duration_minutes, cleanup_minutes, bookable, price, stock from items order by name`);
    expect(items.rows).toEqual([
      { name: 'Corte', kind: 'service', kind_confirmed: false, duration_minutes: 30, cleanup_minutes: 0, bookable: true, price: 30000, stock: 0 },
      { name: 'Shampoo', kind: 'product', kind_confirmed: false, duration_minutes: 30, cleanup_minutes: 0, bookable: true, price: 20000, stock: 5 },
    ]);
    expect((await pool.query(`select name, phone from clients`)).rows).toEqual([{ name: 'Cliente de siempre', phone: '573001112233' }]);
    expect((await pool.query(`select email from users`)).rows).toEqual([{ email: 'viejo@correo.com' }]);
    expect((await pool.query(`select slug from businesses`)).rows).toEqual([{ slug: 'vieja-barberia' }]);

    expect((await pool.query(`select 1 from pg_extension where extname = 'btree_gist'`)).rowCount).toBe(1);
    expect((await pool.query(`select 1 from pg_constraint where conname = 'appointments_no_overlap'`)).rowCount).toBe(1);
    expect((await pool.query(`select 1 from pg_roles where rolname = 'xiro_app' and not rolcanlogin and not rolsuper`)).rowCount).toBe(1);
    // Todas las tablas nuevas con datos de negocio tienen RLS activado (las de citas desde 0006; mensajería desde 0013,
    // ventas desde 0014, gastos/cierre de caja desde 0016 y pedidos de productos desde 0025: nacen protegidas en vez de esperar a una fase aparte).
    const rls = await pool.query(`select relname from pg_class where relrowsecurity and relkind = 'r' order by relname`);
    expect(rls.rows.map((r) => r.relname)).toEqual([
      'appointment_events', 'appointment_items', 'appointments', 'business_closures', 'business_public_profiles', 'business_settings', 'cash_closings', 'cash_openings', 'conversations', 'discount_codes',
      'employee_profiles', 'employee_schedules', 'employee_services', 'employee_time_off', 'expense_adjustments', 'expenses', 'messages', 'product_order_items', 'product_orders', 'reviews', 'sale_items', 'sale_payments', 'sales',
      'service_package_entries', 'service_packages', 'service_variants', 'waitlist_entries',
    ]);
  });

  it('volver a ejecutar las migraciones no cambia nada (idempotente)', async () => {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect((await pool.query(`select count(*)::int as n from items`)).rows[0].n).toBe(2);
  });
});
