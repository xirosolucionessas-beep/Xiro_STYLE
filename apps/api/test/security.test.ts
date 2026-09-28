import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AuthSession, Client, Item } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuildOptions } from '../src/app';
import { businesses, clients, items, users } from '../src/db/schema';
import type { Notifier, OtpMessage } from '../src/notifier';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

const SECRET = 'test-secret-test-secret-test-secret-123';
let testDb: TestDatabase;
let app: FastifyInstance;
let cleanups: Array<() => void> = [];
const apps: FastifyInstance[] = [];
const otps: OtpMessage[] = [];
const notifier: Notifier = { sendOtp: async (message) => void otps.push(message), sendAppointmentReminder: async () => undefined };

async function makeApp(config: BuildOptions['config'] = {}) {
  const setup = testAppConfig(config);
  cleanups.push(setup.cleanup);
  const instance = await buildApp({ db: testDb.db, notifier, config: setup.config });
  apps.push(instance);
  return instance;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  app = await makeApp();
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  cleanups.forEach((fn) => fn());
  await testDb.drop();
});

let counter = 0;
async function register(instance: FastifyInstance = app, overrides: Record<string, unknown> = {}): Promise<AuthSession> {
  counter += 1;
  const res = await instance.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `10.9.${counter % 250}.${(counter * 7) % 250}`,
    payload: { name: 'Ana', businessName: `Seg ${counter}`, email: `s${counter}-${Date.now()}@correo.com`, password: 'Secreta123', acceptTerms: true, ...overrides },
  });
  expect(res.statusCode).toBe(201);
  return res.json<AuthSession>();
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/* ---- JWT hechos a mano para probar ataques ---- */
const b64 = (value: object | Buffer) => (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString('base64url');
function forge(payload: Record<string, unknown>, options: { alg?: 'HS256' | 'HS384' | 'HS512' | 'none'; secret?: string } = {}) {
  const alg = options.alg ?? 'HS256';
  const head = b64({ alg, typ: 'JWT' });
  const body = b64(payload);
  const signature = alg === 'none' ? '' : createHmac(`sha${alg.slice(2)}`, options.secret ?? SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (session: AuthSession, extra: Record<string, unknown> = {}) => ({ sub: session.user.id, bid: session.business.id, iss: 'xiro-style-api', aud: 'xiro-style-app', iat: now(), exp: now() + 600, ...extra });

describe('JWT: ataques de falsificación', () => {
  it('acepta un token legítimo (control) y el forjado con los mismos parámetros correctos', async () => {
    const session = await register();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: bearer(session.accessToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: bearer(forge(claims(session))) })).statusCode).toBe(200);
  });

  it.each([
    ['alg "none" (sin firma)', (s: AuthSession) => forge(claims(s), { alg: 'none' })],
    ['firmado con otro secreto', (s: AuthSession) => forge(claims(s), { secret: 'otro-secreto-otro-secreto-otro-1234' })],
    ['algoritmo distinto (HS512 con el secreto correcto)', (s: AuthSession) => forge(claims(s), { alg: 'HS512' })],
    ['audiencia ajena', (s: AuthSession) => forge(claims(s, { aud: 'otra-app' }))],
    ['emisor ajeno', (s: AuthSession) => forge(claims(s, { iss: 'otro-servicio' }))],
    ['caducado', (s: AuthSession) => forge(claims(s, { iat: now() - 3600, exp: now() - 60 }))],
    ['sin expiración', (s: AuthSession) => forge((({ exp: _exp, ...rest }) => rest)(claims(s)))],
    ['sub que no es un UUID', (s: AuthSession) => forge(claims(s, { sub: "1' OR '1'='1" }))],
    ['negocio distinto al del usuario (escalada entre inquilinos)', (s: AuthSession) => forge(claims(s, { bid: '00000000-0000-4000-8000-000000000000' }))],
    ['usuario inexistente', (s: AuthSession) => forge(claims(s, { sub: '00000000-0000-4000-8000-000000000001' }))],
  ])('rechaza: %s', async (_name, build) => {
    const session = await register();
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(build(session)) });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  it('rechaza un payload alterado con la firma original', async () => {
    const session = await register();
    const [head, , signature] = session.accessToken.split('.');
    const tampered = `${head}.${b64({ ...claims(session), bid: '00000000-0000-4000-8000-000000000000' })}.${signature}`;
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: bearer(tampered) })).statusCode).toBe(401);
  });

  it('cambiar la contraseña invalida los access tokens ya emitidos', async () => {
    const session = await register();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: bearer(session.accessToken) })).statusCode).toBe(200);
    await testDb.db.update(users).set({ passwordChangedAt: new Date(Date.now() + 5_000) }).where(eq(users.id, session.user.id));
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: bearer(session.accessToken) })).statusCode).toBe(401);
  });

  it('un usuario eliminado pierde el acceso al instante (aunque su token no haya caducado)', async () => {
    const session = await register();
    await testDb.db.delete(users).where(eq(users.id, session.user.id));
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: bearer(session.accessToken) })).statusCode).toBe(401);
  });

  it('el access token dura 15 minutos y lleva emisor y audiencia', async () => {
    const session = await register();
    const payload = JSON.parse(Buffer.from(session.accessToken.split('.')[1]!, 'base64url').toString());
    expect(payload.iss).toBe('xiro-style-api');
    expect(payload.aud).toBe('xiro-style-app');
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });
});

describe('cabeceras de seguridad', () => {
  it('Helmet: CSP estricta, anti-clickjacking, nosniff, referrer y permisos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' blob:"); // la subida de fotos desde la web lee blob: con fetch()
    expect(csp).not.toMatch(/connect-src[^;]*\s\*/); // sin comodín
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toContain('geolocation=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('HSTS solo cuando se activa (producción) y CSP con orígenes extra configurables', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).headers['strict-transport-security']).toBeUndefined();
    const strict = await makeApp({ security: { hsts: true, cspConnect: ['https://api.ejemplo.com'], cspImg: ['https://cdn.ejemplo.com'] } });
    const res = await strict.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(String(res.headers['content-security-policy'])).toContain("connect-src 'self' blob: https://api.ejemplo.com");
    expect(String(res.headers['content-security-policy'])).toContain('https://cdn.ejemplo.com');
  });

  it('las respuestas privadas no se cachean (no-store), las públicas revalidan en 15 s', async () => {
    const session = await register();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: bearer(session.accessToken) })).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: 'x@y.com', password: 'z' } })).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/${session.business.slug}` })).headers['cache-control']).toContain('max-age=15');
  });

  it('CORS estricto: solo los orígenes configurados en rutas privadas, sin credenciales', async () => {
    const ok = await app.inject({ method: 'OPTIONS', url: '/api/items', headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'GET' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    for (const origin of ['https://evil.example', 'http://localhost:8081.evil.com', 'null']) {
      const denied = await app.inject({ method: 'OPTIONS', url: '/api/items', headers: { origin, 'access-control-request-method': 'GET' } });
      expect(denied.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });
});

describe('límite de peticiones', () => {
  it('por IP: supera el máximo → 429 con Retry-After; el health check y otras IP no se ven afectados', async () => {
    const limited = await makeApp({ rateLimit: { enabled: true, globalPerMinute: 5, authPerMinute: 1000 } });
    const hit = (ip: string) => limited.inject({ method: 'GET', url: '/api/categories', remoteAddress: ip });
    const codes: number[] = [];
    for (let i = 0; i < 8; i += 1) codes.push((await hit('203.0.113.7')).statusCode);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
    const blocked = await hit('203.0.113.7');
    expect(blocked.json().code).toBe('too_many_requests');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect((await hit('203.0.113.8')).statusCode).toBe(401); // otra IP: intacta
    expect((await limited.inject({ method: 'GET', url: '/api/health', remoteAddress: '203.0.113.7' })).statusCode).toBe(200);
  });

  it('en endpoints de autenticación es mucho más estricto (por IP)', async () => {
    const limited = await makeApp({ rateLimit: { enabled: true, globalPerMinute: 1000, authPerMinute: 3, accountAttempts: 1000 } });
    const login = () => limited.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '198.51.100.9', payload: { identifier: 'x@y.com', password: 'mala' } });
    expect([(await login()).statusCode, (await login()).statusCode, (await login()).statusCode]).toEqual([401, 401, 401]);
    expect((await login()).statusCode).toBe(429);
  });

  it('por usuario autenticado: un usuario abusivo se frena sin afectar a otro, aunque cambie de IP', async () => {
    const limited = await makeApp({ rateLimit: { enabled: true, globalPerMinute: 1000, authPerMinute: 1000, userPerMinute: 5 } });
    const abuser = await register(limited);
    const bystander = await register(limited);
    const call = (s: AuthSession, ip: string) => limited.inject({ method: 'GET', url: '/api/categories', headers: bearer(s.accessToken), remoteAddress: ip });

    const codes: number[] = [];
    for (let i = 0; i < 7; i += 1) codes.push((await call(abuser, `192.0.2.${i + 10}`)).statusCode); // cada petición desde una IP distinta
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    const limitedRes = await call(abuser, '192.0.2.99');
    expect(limitedRes.headers['retry-after']).toBeDefined();
    expect((await call(bystander, '192.0.2.50')).statusCode).toBe(200);
  });

  it('fuerza bruta por cuenta: tras N fallos se bloquea aunque el atacante cambie de IP, y un acierto antes del umbral reinicia la cuenta', async () => {
    const limited = await makeApp({ rateLimit: { enabled: true, globalPerMinute: 1000, authPerMinute: 1000, accountAttempts: 3 } });
    const victim = await register(limited);
    const email = victim.user.email!;
    const login = (password: string, ip: string) => limited.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { identifier: email, password } });

    expect((await login('Incorrecta1', '10.1.1.1')).statusCode).toBe(401);
    expect((await login('Incorrecta2', '10.1.1.2')).statusCode).toBe(401);
    expect((await login('Secreta123', '10.1.1.3')).statusCode).toBe(200); // acierto: reinicia el contador
    for (const ip of ['10.2.2.1', '10.2.2.2', '10.2.2.3']) expect((await login('Mala1234', ip)).statusCode).toBe(401);
    const blocked = await login('Secreta123', '10.2.2.4'); // ni la contraseña correcta pasa mientras dure el bloqueo
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();

    const other = await register(limited);
    expect((await limited.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: other.user.email, password: 'Secreta123' } })).statusCode).toBe(200);
  });

  it('solicitudes de OTP por cuenta: frena el spam de SMS/correo, exista o no la cuenta', async () => {
    const limited = await makeApp({ rateLimit: { enabled: true, globalPerMinute: 1000, authPerMinute: 1000, accountAttempts: 3 } });
    const request = (identifier: string, ip: string) => limited.inject({ method: 'POST', url: '/api/auth/recover/request', remoteAddress: ip, payload: { identifier, channel: 'email' } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await request('nadie@correo.com', `10.3.3.${i}`)).statusCode);
    expect(codes).toEqual([202, 202, 202, 429, 429]);
  });
});

describe('validación y sanitización de entradas', () => {
  it('las cargas de inyección SQL se guardan como texto inerte y las tablas siguen intactas', async () => {
    const session = await register();
    const evil = "'; DROP TABLE users; --";
    const category = (await app.inject({ method: 'GET', url: '/api/categories', headers: bearer(session.accessToken) })).json<Array<{ id: string }>>()[0]!;
    const created = await app.inject({ method: 'POST', url: '/api/items', headers: bearer(session.accessToken), payload: { name: evil, categoryId: category.id, price: 1, description: "1' OR '1'='1" } });
    expect(created.statusCode).toBe(201);
    expect(created.json<Item>().name).toBe(evil);
    await app.inject({ method: 'POST', url: '/api/clients', headers: bearer(session.accessToken), payload: { name: "Robert'); DROP TABLE clients;--" } });

    expect((await testDb.db.select({ id: users.id }).from(users).limit(1)).length).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: bearer(session.accessToken) })).statusCode).toBe(200);
    const search = await app.inject({ method: 'GET', url: `/api/clients?q=${encodeURIComponent("' OR '1'='1")}`, headers: bearer(session.accessToken) });
    expect(search.json<Client[]>()).toEqual([]);
    const byName = await app.inject({ method: 'GET', url: `/api/clients?q=${encodeURIComponent('DROP TABLE')}`, headers: bearer(session.accessToken) });
    expect(byName.json<Client[]>()).toHaveLength(1);
  });

  it('la búsqueda trata % y _ como texto literal', async () => {
    const session = await register();
    for (const name of ['Ana 100%', 'Luis', 'Mar_ta']) await app.inject({ method: 'POST', url: '/api/clients', headers: bearer(session.accessToken), payload: { name } });
    const find = async (q: string) => (await app.inject({ method: 'GET', url: `/api/clients?q=${encodeURIComponent(q)}`, headers: bearer(session.accessToken) })).json<Client[]>().map((c) => c.name);
    expect(await find('%')).toEqual(['Ana 100%']);
    expect(await find('_')).toEqual(['Mar_ta']);
    expect(await find('\\')).toEqual([]);
  });

  it('ids con formato inválido responden 404 (sin llegar a la base de datos) y slugs raros no rompen nada', async () => {
    const session = await register();
    for (const url of ['/api/items/xyz', "/api/items/1' OR '1'='1", '/api/clients/%2e%2e%2fme','/api/categories/%00']) {
      expect((await app.inject({ method: 'GET', url, headers: bearer(session.accessToken) })).statusCode, url).toBeGreaterThanOrEqual(400);
      expect([400, 404]).toContain((await app.inject({ method: 'GET', url, headers: bearer(session.accessToken) })).statusCode);
    }
    expect((await app.inject({ method: 'GET', url: "/api/public/catalog/x'%20OR%20'1'='1" })).statusCode).toBe(404);
  });

  it('rechaza el carácter NUL (que PostgreSQL no admite) con 400 en vez de un error 500', async () => {
    const session = await register();
    const res = await app.inject({ method: 'POST', url: '/api/clients', headers: bearer(session.accessToken), payload: { name: 'Ana\u0000Pérez' } });
    expect(res.statusCode).toBe(400);
    const nested = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: 'a@b.com', password: 'x\u0000y' } });
    expect(nested.statusCode).toBe(400);
  });

  it('descarta campos desconocidos: no hay asignación masiva (role, businessId, id…)', async () => {
    const session = await register(app, { role: 'admin', businessId: '00000000-0000-4000-8000-000000000000', id: '00000000-0000-4000-8000-0000000000aa' });
    const [user] = await testDb.db.select().from(users).where(eq(users.id, session.user.id));
    expect(user!.role).toBe('owner');
    expect(user!.businessId).toBe(session.business.id);
    expect(user!.id).not.toBe('00000000-0000-4000-8000-0000000000aa');

    const category = (await app.inject({ method: 'GET', url: '/api/categories', headers: bearer(session.accessToken) })).json<Array<{ id: string }>>()[0]!;
    const other = await register();
    const item = await app.inject({ method: 'POST', url: '/api/items', headers: bearer(session.accessToken), payload: { name: 'X', categoryId: category.id, price: 1, businessId: other.business.id } });
    const [row] = await testDb.db.select().from(items).where(eq(items.id, item.json<Item>().id));
    expect(row!.businessId).toBe(session.business.id);
  });

  it('el HTML/JS malicioso se devuelve como JSON inerte (Content-Type correcto, nosniff) y el catálogo lo escapa', async () => {
    const session = await register();
    const category = (await app.inject({ method: 'GET', url: '/api/categories', headers: bearer(session.accessToken) })).json<Array<{ id: string }>>()[0]!;
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const item = (await app.inject({ method: 'POST', url: '/api/items', headers: bearer(session.accessToken), payload: { name: xss, categoryId: category.id, price: 1 } })).json<Item>();
    const api = await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers: bearer(session.accessToken) });
    expect(api.headers['content-type']).toContain('application/json');
    expect(api.headers['x-content-type-options']).toBe('nosniff');
    const page = await app.inject({ method: 'GET', url: `/catalog/${session.business.slug}/item/${item.id}` });
    expect(page.body).not.toContain('<script>alert(2)</script>');
    expect(page.body).not.toContain('<img src=x');
    expect(page.body).toContain('&lt;img src=x');
  });

  it('valida tipos, rangos y límites de tamaño', async () => {
    const session = await register();
    const category = (await app.inject({ method: 'GET', url: '/api/categories', headers: bearer(session.accessToken) })).json<Array<{ id: string }>>()[0]!;
    const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/items', headers: bearer(session.accessToken), payload: payload as object });
    for (const bad of [
      { name: 'X', categoryId: category.id, price: '10' },
      { name: 'X', categoryId: category.id, price: 2_000_000_000 },
      { name: 'X', categoryId: category.id, price: 1, stock: -1 },
      { name: 'X'.repeat(200), categoryId: category.id, price: 1 },
      { name: 'X', categoryId: 'no-uuid', price: 1 },
      { name: ['X'], categoryId: category.id, price: 1 },
      null,
    ]) {
      expect((await post(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    const huge = await app.inject({ method: 'POST', url: '/api/clients', headers: { ...bearer(session.accessToken), 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'x', notes: 'y'.repeat(2_000_000) }) });
    expect(huge.statusCode).toBe(413);
  });
});

describe('integridad a nivel de base de datos', () => {
  it('la propia base de datos rechaza stock/precios inválidos y categorías de otro negocio (aunque el código fallara)', async () => {
    const a = await register();
    const b = await register();
    const catB = (await app.inject({ method: 'GET', url: '/api/categories', headers: bearer(b.accessToken) })).json<Array<{ id: string }>>()[0]!;
    const insert = (values: Partial<typeof items.$inferInsert>) =>
      testDb.db.insert(items).values({ businessId: a.business.id, categoryId: catB.id, name: 'X', price: 1, stockStatus: 'available', ...values });

    await expect(insert({})).rejects.toMatchObject({ cause: { code: '23503' } }); // FK compuesta: categoría de otro negocio
    const ownCat = (await app.inject({ method: 'GET', url: '/api/categories', headers: bearer(a.accessToken) })).json<Array<{ id: string }>>()[0]!;
    await expect(insert({ categoryId: ownCat.id, stock: -5 })).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(insert({ categoryId: ownCat.id, price: -1 })).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(insert({ categoryId: ownCat.id, stockStatus: 'inventado' })).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(testDb.db.insert(clients).values({ businessId: '00000000-0000-4000-8000-000000000000', name: 'huérfano' })).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(testDb.db.update(businesses).set({ currency: 'XXX' }).where(eq(businesses.id, a.business.id))).rejects.toMatchObject({ cause: { code: '23514' } });
  });
});
