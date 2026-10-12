import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase, directDatabaseConfig, poolOptions } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { otpCodes, refreshTokens, resetTokens, users } from '../src/db/schema';
import { purgeExpired } from '../src/maintenance';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

const env = (extra: Record<string, string>) => ({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@db.example.com:5432/xiro', REDIS_URL: 'rediss://default:x@redis.example.com:6379', S3_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com', S3_BUCKET: 'xiro-media', S3_ACCESS_KEY_ID: 'clave', S3_SECRET_ACCESS_KEY: 'secreto', ...extra }) as NodeJS.ProcessEnv;

describe('configuración', () => {
  it('en producción exige Redis (límites compartidos entre instancias) y valida su URL', () => {
    expect(() => loadConfig({ ...env({}), REDIS_URL: undefined })).toThrow(/REDIS_URL/);
    expect(() => loadConfig(env({ REDIS_URL: 'http://redis' }))).toThrow(/REDIS_URL/);
    expect(loadConfig(env({})).redis.url).toBe('rediss://default:x@redis.example.com:6379');
    expect(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).redis.url).toBeNull(); // en desarrollo: memoria
  });

  it('ADMIN_SECRET débil o de ejemplo impide arrancar', () => {
    expect(() => loadConfig(env({ ADMIN_SECRET: 'corto' }))).toThrow(/32 caracteres/);
    expect(() => loadConfig(env({ ADMIN_SECRET: 'changeme-changeme-changeme-changeme' }))).toThrow(/ejemplo/);
    expect(loadConfig(env({ ADMIN_SECRET: 'q'.repeat(10) + 'Zr8!vLm2#pW9xT4kB7nQ1sD6' })).subscriptions.adminSecret).toBeTruthy();
    expect(loadConfig(env({ ADMIN_ALLOWED_IPS: '10.0.0.5, 10.0.0.6' })).subscriptions.adminAllowedIps).toEqual(['10.0.0.5', '10.0.0.6']);
  });

  it('en producción exige DATABASE_URL, un JWT_SECRET largo y rechaza ajustes inseguros', () => {
    expect(() => loadConfig(env({ DATABASE_URL: '' }))).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...env({}), DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig(env({ JWT_SECRET: 'corto' }))).toThrow(/JWT_SECRET/);
    expect(() => loadConfig(env({ EXPOSE_DEV_OTP: 'true' }))).toThrow(/EXPOSE_DEV_OTP/);
    expect(() => loadConfig(env({ RATE_LIMIT: 'off' }))).toThrow(/RATE_LIMIT/);
    expect(() => loadConfig(env({ CORS_ORIGINS: '*' }))).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig(env({ CORS_ORIGINS: 'http://app.example.com' }))).toThrow(/https/);
    expect(() => loadConfig(env({ CORS_ORIGINS: 'https://app.example.com/ruta' }))).toThrow(/origen/);
    expect(() => loadConfig(env({ DATABASE_URL: 'mysql://x' }))).toThrow(/postgres/);
    expect(() => loadConfig(env({ DB_POOL_MIN: '5', DB_POOL_MAX: '2' }))).toThrow(/DB_POOL_MIN/);
    expect(() => loadConfig(env({ TRUST_PROXY: 'cualquiera' }))).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig(env({ JWT_ACCESS_TTL: 'siempre' }))).toThrow(/JWT_ACCESS_TTL/);
  });

  it('los valores por defecto de producción son los seguros', () => {
    const config = loadConfig(env({ CORS_ORIGINS: 'https://app.example.com', TRUST_PROXY: '1' }));
    expect(config.database.ssl).toBe('require');
    expect(config.security.hsts).toBe(true);
    expect(config.security.csp).toBe(true);
    expect(config.rateLimit.enabled).toBe(true);
    expect(config.autoMigrate).toBe(false);
    expect(config.trustProxy).toBe(1);
    expect(config.accessTokenTtl).toBe('15m');
    expect(config.corsOrigins).toEqual(['https://app.example.com']);
  });

  it('en desarrollo arranca sin configurar nada y con el secreto efímero', () => {
    const config = loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.database.ssl).toBe('disable');
    expect(config.autoMigrate).toBe(true);
  });

  it('el pool recibe todos los límites y tiempos de espera', () => {
    const config = loadConfig(env({ DB_POOL_MAX: '25', DB_POOL_MIN: '2', DB_IDLE_TIMEOUT_MS: '10000', DB_CONNECTION_TIMEOUT_MS: '3000', DB_STATEMENT_TIMEOUT_MS: '8000', DB_MAX_LIFETIME_SECONDS: '600' }));
    expect(poolOptions(config.database)).toMatchObject({
      max: 25,
      min: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 3_000,
      statement_timeout: 8_000,
      query_timeout: 10_000,
      idle_in_transaction_session_timeout: 16_000,
      maxLifetimeSeconds: 600,
      ssl: { rejectUnauthorized: true },
      keepAlive: true,
    });
  });

  it('detrás de PgBouncer/pooler (DB_SESSION_PARAMS=none) no envía parámetros de arranque, pero conserva el timeout del cliente', () => {
    const config = loadConfig(env({ DB_SESSION_PARAMS: 'none', DB_STATEMENT_TIMEOUT_MS: '8000', DATABASE_DIRECT_URL: 'postgres://u:p@db-direct.example.com:5432/xiro' }));
    const options = poolOptions(config.database);
    expect(options).not.toHaveProperty('statement_timeout');
    expect(options).not.toHaveProperty('idle_in_transaction_session_timeout');
    expect(options.query_timeout).toBe(10_000);
    expect(() => loadConfig(env({ DB_SESSION_PARAMS: 'otro' }))).toThrow();
    expect(loadConfig(env({})).shutdownTimeoutMs).toBe(25_000);
    // En producción, detrás de un pooler hace falta la conexión directa (LISTEN, pg-boss, migraciones).
    expect(() => loadConfig(env({ DB_SESSION_PARAMS: 'none' }))).toThrow(/DATABASE_DIRECT_URL/);
    expect(() => loadConfig(env({ DATABASE_DIRECT_URL: 'mysql://x' }))).toThrow(/DATABASE_DIRECT_URL/);
    // La conexión directa usa la URL directa y SÍ lleva los parámetros de sesión (una conexión directa los acepta).
    const direct = poolOptions(directDatabaseConfig(config.database, 1));
    expect(direct).toMatchObject({ connectionString: 'postgres://u:p@db-direct.example.com:5432/xiro', max: 1, statement_timeout: 8_000 });
    expect(poolOptions(directDatabaseConfig(loadConfig(env({})).database)).connectionString).toBe('postgres://u:p@db.example.com:5432/xiro');
  });
});

describe('base de datos', () => {
  let testDb: TestDatabase;
  beforeAll(async () => {
    testDb = await createTestDatabase();
  });
  afterAll(async () => testDb.drop());

  it('las migraciones son idempotentes y seguras si varias instancias arrancan a la vez', async () => {
    await runMigrations(testDb); // ya estaban aplicadas al crear la base
    const before = await testDb.pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
    await Promise.all([runMigrations(testDb), runMigrations(testDb), runMigrations(testDb)]);
    const { rows } = await testDb.pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
    // El número exacto crece con cada migración nueva del proyecto: lo que importa es que 3 arranques a la vez
    // no la apliquen más de una vez cada una (ni se pierda ni se duplique ningún archivo de migración).
    expect(rows[0].n).toBe(before.rows[0].n);
  });

  it('migra una base nueva con un pool de UNA conexión (como `npm run db:migrate` y el arranque con DATABASE_DIRECT_URL)', async () => {
    // Antes el candado ocupaba la única conexión y la migración esperaba otra hasta el timeout.
    const single = await createTestDatabase({ poolMax: 1, connectionTimeoutMs: 3_000 });
    try {
      const { rows } = await single.pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
      expect(rows[0].n).toBeGreaterThan(20);
    } finally {
      await single.drop();
    }
  });

  it('el esquema tiene los índices que respaldan las consultas frecuentes', async () => {
    const { rows } = await testDb.pool.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public'`);
    const names = rows.map((r) => r.indexname);
    for (const expected of ['items_business_updated_idx', 'items_category_idx', 'items_public_idx', 'categories_business_name_uq', 'users_email_uq', 'businesses_slug_uq']) {
      expect(names, expected).toContain(expected);
    }
  });

  it('la conexión aplica statement_timeout y application_name', async () => {
    const short = createDatabase({ ...testDb.config, statementTimeoutMs: 500, poolMax: 2, applicationName: 'xiro-test' }, () => undefined);
    try {
      const { rows } = await short.pool.query('show application_name');
      expect(rows[0].application_name).toBe('xiro-test');
      await expect(short.pool.query('select pg_sleep(3)')).rejects.toMatchObject({ code: '57014' });
    } finally {
      await short.close();
    }
  });

  it('un pool saturado falla rápido (connectionTimeout) en vez de esperar sin fin', async () => {
    const tiny = createDatabase({ ...testDb.config, poolMax: 1, connectionTimeoutMs: 3_000 }, () => undefined); // margen para que la 1.ª conexión se establezca en máquinas cargadas
    const held = await tiny.pool.connect();
    try {
      const started = Date.now();
      await expect(tiny.pool.connect()).rejects.toThrow(/timeout/i);
      expect(Date.now() - started).toBeLessThan(15_000); // lo que importa: falla en vez de esperar sin fin
    } finally {
      held.release();
      await tiny.close();
    }
  });

  it('purgeExpired elimina solo lo caducado', async () => {
    const app = await buildApp({ db: testDb.db, ...(() => { const s = testAppConfig(); return { config: s.config }; })() });
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: 'Purga', email: 'purga@correo.com', password: 'Secreta123', acceptTerms: true } });
    const userId = reg.json().user.id as string;
    const past = new Date(Date.now() - 3 * 24 * 3_600_000);
    await testDb.db.insert(refreshTokens).values({ tokenHash: 'old-hash', userId, familyId: crypto.randomUUID(), expiresAt: past });
    await testDb.db.insert(resetTokens).values({ tokenHash: 'old-reset', userId, expiresAt: past });
    await testDb.db.insert(otpCodes).values({ userId, codeHash: 'x', expiresAt: past });

    const counts = await purgeExpired(testDb.db);
    expect(counts).toEqual({ refresh: 1, otp: 1, reset: 1 });
    expect(await testDb.db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId))).toHaveLength(1); // el vigente de la sesión
    await app.close();
  });

  it('/api/health/ready responde 200 con la base viva y 503 cuando no responde; /api/health sigue vivo', async () => {
    const own = createDatabase(testDb.config, () => undefined);
    const s = testAppConfig();
    const app = await buildApp({ db: own.db, config: s.config });
    expect((await app.inject({ method: 'GET', url: '/api/health/ready' })).json()).toEqual({ status: 'ok', database: 'up', redis: 'not_configured' });
    await own.close(); // simula la caída de la base
    const down = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toEqual({ status: 'unavailable', database: 'down', redis: 'not_configured' });
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    await app.close();
    s.cleanup();
  });

  it('con la base caída, las rutas de datos responden 503 controlado (sin filtrar detalles) y no 500', async () => {
    const own = createDatabase(testDb.config, () => undefined);
    const s = testAppConfig();
    const app = await buildApp({ db: own.db, config: s.config });
    await own.close();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: 'a@b.com', password: 'Secreta123' } });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.body).not.toMatch(/postgres|pool|ECONN|select /i);
    await app.close();
    s.cleanup();
  });

  it('usuarios: el correo se compara sin distinguir mayúsculas y el teléfono es único', async () => {
    const s = testAppConfig();
    const app = await buildApp({ db: testDb.db, config: s.config });
    const base = { name: 'Ana', businessName: 'Dup', password: 'Secreta123', acceptTerms: true };
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...base, email: 'Dup@Correo.com' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...base, email: 'dup@correo.com' } })).statusCode).toBe(409);
    expect((await testDb.db.select().from(users).where(eq(users.email, 'dup@correo.com'))).length).toBe(1);
    await app.close();
    s.cleanup();
  });
});

