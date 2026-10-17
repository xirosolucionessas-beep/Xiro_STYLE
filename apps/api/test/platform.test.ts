import { randomUUID } from 'node:crypto';
import { addCalendarMonthsUtc, grantEnd, grantStart, type AuthSession, type PlatformBusinessDetail, type PlatformOverview, type PlatformSearchResult, type PlatformSeriesDto, type PlatformSessionDto, type Subscription } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createAdmin } from '../src/platform/admins';
import { decryptSecret, encryptSecret, totpCode, totpStep, verifyTotp } from '../src/platform/crypto';
import { at, book, setupBiz, workday } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Panel del fundador (routes/platform.ts). Todo con datos de prueba en una base aislada: ninguna operación toca datos reales.
 */
const ADMIN_KEY = 'clave-de-prueba-del-panel-de-plataforma-0123456789';
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig({ platform: { adminKey: ADMIN_KEY } });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const q = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => testDb.pool.query(text, values).then((r) => r.rows as T[]);
const PASSWORD = 'Secreta123';
let counter = 0;

async function registerBusiness(name?: string): Promise<AuthSession & { email: string }> {
  counter += 1;
  const email = `dueno${counter}@correo.com`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Dueño', businessName: name ?? `Barbería Plataforma ${counter}`, businessType: 'barbershop', email, password: PASSWORD, acceptTerms: true, language: 'es' } });
  expect(res.statusCode).toBe(201);
  return { ...res.json<AuthSession>(), email };
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

interface TestAdmin {
  email: string;
  password: string;
  secret: string;
  token: string;
}

/** Un código TOTP aceptable ahora mismo (se reinicia el anti-repetición para poder pedir varios en la misma ventana de 30 s). */
async function freshCode(admin: { email: string; secret: string }): Promise<string> {
  await q(`update platform_admins set totp_last_step = 0 where email = $1`, [admin.email]);
  return totpCode(admin.secret, totpStep());
}

async function makeAdmin(options: { founder?: boolean; permissions?: string[] } = {}): Promise<TestAdmin> {
  counter += 1;
  const enrollment = await createAdmin(testDb.db, ADMIN_KEY, { email: `admin${counter}@xiro.test`, name: `Admin ${counter}`, ...options });
  const res = await app.inject({ method: 'POST', url: '/api/platform/auth/login', payload: { email: enrollment.email, password: enrollment.password, totp: totpCode(enrollment.totpSecret, totpStep()) } });
  expect(res.statusCode).toBe(200);
  return { email: enrollment.email, password: enrollment.password, secret: enrollment.totpSecret, token: res.json<PlatformSessionDto>().token };
}

const call = (admin: { token: string }, method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url: `/api/platform${url}`, headers: bearer(admin.token), payload: payload as object | undefined });

describe('criptografía del panel', () => {
  it('TOTP coincide con el vector de la RFC 6238 y rechaza códigos ya usados', () => {
    // RFC 6238, apéndice B: secreto ASCII "12345678901234567890", T = 59 s -> 94287082 (8 dígitos); con 6 dígitos: 287082.
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpCode(secret, 1)).toBe('287082');
    const now = 59_000;
    expect(verifyTotp(secret, '287082', 0, now)).toBe(1);
    expect(verifyTotp(secret, '287082', 1, now)).toBeNull(); // mismo paso: repetición
    expect(verifyTotp(secret, '000000', 0, now)).toBeNull();
    expect(verifyTotp(secret, 'abc', 0, now)).toBeNull();
  });

  it('el secreto TOTP se guarda cifrado y no se descifra con otra clave', async () => {
    const sealed = encryptSecret(ADMIN_KEY, 'JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(ADMIN_KEY, sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(`${ADMIN_KEY}-otra`, sealed)).toThrow();
    const admin = await createAdmin(testDb.db, ADMIN_KEY, { email: 'cifrado@xiro.test', name: 'Cifrado' });
    const [row] = await q<{ totp_secret_enc: string; password_hash: string }>(`select totp_secret_enc, password_hash from platform_admins where email = 'cifrado@xiro.test'`);
    expect(row!.totp_secret_enc).not.toContain(admin.totpSecret);
    expect(row!.password_hash).not.toContain(admin.password);
  });

  it('meses calendario: fin de mes cae en el último día del mes destino; días = 24 h exactas', () => {
    expect(addCalendarMonthsUtc(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addCalendarMonthsUtc(new Date('2027-01-31T10:00:00Z'), 1).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(addCalendarMonthsUtc(new Date('2026-03-31T00:00:00Z'), 1).toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(addCalendarMonthsUtc(new Date('2026-11-15T00:00:00Z'), 3).toISOString()).toBe('2027-02-15T00:00:00.000Z');
    expect(addCalendarMonthsUtc(new Date('2026-05-10T00:00:00Z'), 24).toISOString()).toBe('2028-05-10T00:00:00.000Z');
    expect(grantEnd(new Date('2026-03-07T12:00:00Z'), 'days', 2).toISOString()).toBe('2026-03-09T12:00:00.000Z');
    const now = new Date('2026-10-01T00:00:00Z');
    expect(grantStart(now, [null, new Date('2026-09-01T00:00:00Z')])).toEqual(now); // vencido: cuenta desde hoy
    expect(grantStart(now, [new Date('2026-10-20T00:00:00Z'), new Date('2026-10-10T00:00:00Z')]).toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});

describe('acceso administrativo', () => {
  it('sin PLATFORM_ADMIN_KEY el panel no existe (404)', async () => {
    const { config, cleanup } = testAppConfig();
    const plain = await buildApp({ db: testDb.db, config });
    try {
      expect((await plain.inject({ method: 'POST', url: '/api/platform/auth/login', payload: {} })).statusCode).toBe(404);
      expect((await plain.inject({ method: 'GET', url: '/api/platform/metrics/overview' })).statusCode).toBe(404);
    } finally {
      await plain.close();
      cleanup();
    }
  });

  it('inicio de sesión exige contraseña Y código TOTP; todos los fallos responden igual y quedan auditados', async () => {
    const enrollment = await createAdmin(testDb.db, ADMIN_KEY, { email: 'login@xiro.test', name: 'Login' });
    const login = (payload: object) => app.inject({ method: 'POST', url: '/api/platform/auth/login', payload });
    const code = () => totpCode(enrollment.totpSecret, totpStep());
    const wrongPassword = await login({ email: enrollment.email, password: 'otra-clave-cualquiera', totp: code() });
    const wrongCode = await login({ email: enrollment.email, password: enrollment.password, totp: code() === '000000' ? '111111' : '000000' });
    const unknown = await login({ email: 'nadie@xiro.test', password: enrollment.password, totp: code() });
    const noCode = await login({ email: enrollment.email, password: enrollment.password });
    for (const res of [wrongPassword, wrongCode, unknown]) expect([res.statusCode, res.json().code]).toEqual([401, 'invalid_credentials']);
    expect(noCode.statusCode).toBe(400);

    const ok = await login({ email: enrollment.email, password: enrollment.password, totp: code() });
    expect(ok.statusCode).toBe(200);
    const session = ok.json<PlatformSessionDto>();
    expect(session.token).toMatch(/^xpa_/);
    expect(session.admin).toMatchObject({ email: 'login@xiro.test', isFounder: false, permissions: [] });
    // El mismo código no sirve otra vez (anti-repetición), aunque siga vigente.
    expect((await login({ email: enrollment.email, password: enrollment.password, totp: code() })).statusCode).toBe(401);

    const audit = await q<{ outcome: string; details: unknown }>(`select outcome, details from platform_audit_log where action = 'auth.login' order by created_at`);
    expect(audit.filter((a) => a.outcome === 'denied').length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(audit)).not.toContain(enrollment.password);
    expect(JSON.stringify(audit)).not.toContain('nadie@xiro.test');
  });

  it('un administrador desactivado no entra y sus sesiones dejan de valer', async () => {
    const admin = await makeAdmin({ permissions: ['metrics_view'] });
    expect((await call(admin, 'GET', '/auth/me')).statusCode).toBe(200);
    await q(`update platform_admins set active = false where email = $1`, [admin.email]);
    expect((await call(admin, 'GET', '/auth/me')).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/platform/auth/login', payload: { email: admin.email, password: admin.password, totp: await freshCode(admin) } });
    expect(res.statusCode).toBe(401);
  });

  it('separación total de identidades: un token de negocio no abre el panel y uno de plataforma no abre un negocio', async () => {
    const owner = await registerBusiness();
    const admin = await makeAdmin({ founder: true });
    expect((await app.inject({ method: 'GET', url: '/api/platform/metrics/overview', headers: bearer(owner.accessToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/platform/auth/me', headers: bearer(owner.accessToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/business', headers: bearer(admin.token) })).statusCode).toBe(401);
    // Sin token / token inventado con el prefijo correcto.
    expect((await app.inject({ method: 'GET', url: '/api/platform/auth/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/platform/auth/me', headers: bearer(`xpa_${'a'.repeat(43)}`) })).statusCode).toBe(401);
  });

  it('no existe registro de administradores ni forma de darse permisos por la API', async () => {
    const owner = await registerBusiness();
    const admin = await makeAdmin({ permissions: ['metrics_view'] });
    for (const url of ['/api/platform/admins', '/api/platform/auth/register', '/api/platform/admins/me/permissions']) {
      expect((await app.inject({ method: 'POST', url, headers: bearer(admin.token), payload: { permissions: ['business_deactivate'], isFounder: true } })).statusCode).toBe(404);
    }
    // Un usuario de negocio que manipula su perfil no gana nada: rol y permisos de plataforma no existen en su modelo.
    await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(owner.accessToken), payload: { isFounder: true, permissions: ['metrics_view'] } });
    expect((await q(`select count(*)::int as n from platform_admins where email = $1`, [owner.email]))[0]).toEqual({ n: 0 });
    expect((await app.inject({ method: 'GET', url: '/api/platform/metrics/overview', headers: bearer(owner.accessToken) })).statusCode).toBe(401);
  });

  it('permisos por defecto-denegar: sin el permiso, 403 auditado; el fundador puede todo', async () => {
    const owner = await registerBusiness();
    const viewer = await makeAdmin({ permissions: ['metrics_view'] });
    const founder = await makeAdmin({ founder: true });
    expect((await call(viewer, 'GET', '/metrics/overview')).statusCode).toBe(200);
    expect((await call(viewer, 'GET', `/businesses/search?kind=slug&q=${owner.business.slug}`)).statusCode).toBe(403);
    expect((await call(viewer, 'GET', `/businesses/${owner.business.id}`)).statusCode).toBe(403);
    expect((await call(viewer, 'POST', `/businesses/${owner.business.id}/suspend`, { reason: 'Prueba de permisos denegados', confirmSlug: owner.business.slug })).statusCode).toBe(403);
    expect((await call(viewer, 'GET', '/audit')).statusCode).toBe(403);
    const denied = await q<{ n: number }>(`select count(*)::int as n from platform_audit_log a join platform_admins p on p.id = a.admin_id where p.email = $1 and a.outcome = 'denied'`, [viewer.email]);
    expect(denied[0]!.n).toBe(4);
    expect((await call(founder, 'GET', `/businesses/${owner.business.id}`)).statusCode).toBe(200);
    // La negación ocurre antes de tocar el negocio: sigue activo.
    expect((await q<{ access_status: string }>(`select access_status from businesses where id = $1`, [owner.business.id]))[0]!.access_status).toBe('active');
  });

  it('cerrar sesión revoca el token; la inactividad también la vence', async () => {
    const admin = await makeAdmin({ permissions: ['metrics_view'] });
    expect((await call(admin, 'POST', '/auth/logout')).statusCode).toBe(204);
    expect((await call(admin, 'GET', '/auth/me')).statusCode).toBe(401);
    const idle = await makeAdmin({ permissions: ['metrics_view'] });
    await q(`update platform_admin_sessions s set last_seen_at = now() - interval '2 hours' from platform_admins a where a.id = s.admin_id and a.email = $1`, [idle.email]);
    expect((await call(idle, 'GET', '/auth/me')).statusCode).toBe(401);
  });

  it('las acciones sensibles exigen MFA reciente (reautenticación) y la reautenticación no acepta códigos repetidos', async () => {
    const owner = await registerBusiness();
    const admin = await makeAdmin({ founder: true });
    await q(`update platform_admin_sessions s set mfa_at = now() - interval '1 hour' from platform_admins a where a.id = s.admin_id and a.email = $1`, [admin.email]);
    const payload = { reason: 'Prueba de reautenticación requerida', confirmSlug: owner.business.slug };
    const blocked = await call(admin, 'POST', `/businesses/${owner.business.id}/suspend`, payload);
    expect([blocked.statusCode, blocked.json().code]).toEqual([403, 'step_up_required']);
    const code = await freshCode(admin);
    expect((await call(admin, 'POST', '/auth/step-up', { totp: code })).statusCode).toBe(200);
    expect((await call(admin, 'POST', '/auth/step-up', { totp: code })).statusCode).toBe(401); // repetido
    expect((await call(admin, 'POST', `/businesses/${owner.business.id}/suspend`, payload)).statusCode).toBe(200);
  });

  it('fuerza bruta: el inicio de sesión se bloquea por cuenta (429) aunque cambie la IP', async () => {
    const { config, cleanup } = testAppConfig({ platform: { adminKey: ADMIN_KEY }, rateLimit: { enabled: true, accountAttempts: 3 } });
    const limited = await buildApp({ db: testDb.db, config });
    try {
      const enrollment = await createAdmin(testDb.db, ADMIN_KEY, { email: 'fuerza@xiro.test', name: 'Fuerza' });
      const codes: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const res = await limited.inject({ method: 'POST', url: '/api/platform/auth/login', remoteAddress: `10.0.0.${i + 1}`, payload: { email: enrollment.email, password: 'incorrecta-incorrecta', totp: '123456' } });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429, 429]);
    } finally {
      await limited.close();
      cleanup();
    }
  });
});

describe('métricas reales', () => {
  it('los totales coinciden con la base, por estado, con fuente y fórmula; los no calculables se declaran', async () => {
    await registerBusiness();
    await registerBusiness();
    const admin = await makeAdmin({ permissions: ['metrics_view'] });
    const res = await call(admin, 'GET', '/metrics/overview?tz=America/Bogota');
    expect(res.statusCode).toBe(200);
    const body = res.json<PlatformOverview>();
    const [db] = await q<{ total: number; suspended: number; subs: number }>(`select count(*)::int as total, count(*) filter (where access_status = 'suspended')::int as suspended, (select count(*)::int from subscriptions) as subs from businesses`);
    expect(body.businesses.total).toMatchObject({ state: 'ok', value: db!.total, source: 'businesses' });
    expect(body.businesses.byAccessStatus.value!.suspended).toBe(db!.suspended);
    expect(body.subscriptions.byStatus.value!.none).toBe(db!.total - db!.subs);
    expect(body.subscriptions.paymentsInPeriod).toMatchObject({ state: 'ok', value: [] }); // cero real: no hubo pagos
    expect(body.health.find((h) => h.name === 'database')).toMatchObject({ state: 'up' });
    expect(body.health.find((h) => h.name === 'stripe')).toMatchObject({ state: 'not_configured' });
    expect(body.traffic.note).toContain('instancia');
    expect(body.unavailable.map((u) => u.key)).toContain('active_users_now');
    for (const indicator of [body.businesses.total, body.subscriptions.byStatus, body.subscriptions.renewingNext7Days]) {
      expect(indicator.formula.length).toBeGreaterThan(5);
      expect(Date.parse(indicator.asOf)).not.toBeNaN();
    }
  });

  it('la serie de altas cuenta por día local, con ceros reales en los días sin altas', async () => {
    const admin = await makeAdmin({ permissions: ['metrics_view'] });
    // Un negocio "registrado" hace 3 días (datos de prueba).
    const old = await registerBusiness();
    await q(`update businesses set created_at = now() - interval '3 days' where id = $1`, [old.business.id]);
    const res = await call(admin, 'GET', '/metrics/series?metric=new_businesses&grouping=day&tz=UTC');
    expect(res.statusCode).toBe(200);
    const series = res.json<PlatformSeriesDto>();
    expect(series.buckets).toHaveLength(30);
    const [expected] = await q<{ today: number; three: number }>(
      `select count(*) filter (where (created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date)::int as today,
              count(*) filter (where (created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date - 3)::int as three from businesses`,
    );
    expect(series.buckets.at(-1)!.value).toBe(expected!.today);
    expect(series.buckets.at(-4)!.value).toBe(expected!.three);
    expect(series.buckets.reduce((sum, b) => sum + b.value, 0)).toBe(Number((await q<{ n: number }>(`select count(*)::int as n from businesses where created_at >= ((now() at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC'`))[0]!.n));
    // Rangos y zonas inválidos o desmedidos se rechazan (sin consultas sin límite).
    expect((await call(admin, 'GET', '/metrics/series?metric=new_businesses&grouping=day&from=2000-01-01&to=2026-01-01')).statusCode).toBe(400);
    expect((await call(admin, 'GET', '/metrics/series?metric=new_businesses&tz=Mars/Base')).statusCode).toBe(400);
    expect((await call(admin, 'GET', "/metrics/series?metric=users';drop table businesses;--")).statusCode).toBe(400);
  });
});

describe('búsqueda, detalle y aislamiento entre negocios', () => {
  it('encuentra por correo (también de un empleado), nombre, slug e id; la búsqueda queda auditada sin el correo', async () => {
    const owner = await registerBusiness('Salón Búsqueda Única');
    const emp = await app.inject({ method: 'POST', url: '/api/employees', headers: bearer(owner.accessToken), payload: { name: 'Empleada', email: 'empleada.busqueda@correo.com', password: PASSWORD } });
    expect(emp.statusCode).toBe(201);
    const admin = await makeAdmin({ permissions: ['businesses_view'] });
    const find = async (kind: string, value: string) => (await call(admin, 'GET', `/businesses/search?kind=${kind}&q=${encodeURIComponent(value)}`)).json<PlatformSearchResult>().results.map((r) => r.id);
    expect(await find('email', owner.email.toUpperCase())).toEqual([owner.business.id]);
    expect(await find('email', 'empleada.busqueda@correo.com')).toEqual([owner.business.id]);
    expect(await find('name', 'búsqueda únic')).toEqual([owner.business.id]);
    expect(await find('slug', owner.business.slug)).toEqual([owner.business.id]);
    expect(await find('id', owner.business.id)).toEqual([owner.business.id]);
    expect(await find('id', 'no-es-un-uuid')).toEqual([]);
    expect(await find('name', '%')).toEqual([]); // comodines escapados
    const audits = await q<{ details: Record<string, unknown> }>(`select details from platform_audit_log where action = 'business.search'`);
    expect(JSON.stringify(audits)).not.toContain(owner.email);
    expect(JSON.stringify(audits)).not.toContain('empleada.busqueda@correo.com');
  });

  it('el conteo de empleados es del negocio pedido y nada más; el detalle no expone contraseñas ni correos completos', async () => {
    const a = await registerBusiness();
    const b = await registerBusiness();
    const addEmployee = async (owner: AuthSession, n: number) =>
      app.inject({ method: 'POST', url: '/api/employees', headers: bearer(owner.accessToken), payload: { name: `Emp ${n}`, email: `iso-${randomUUID()}@correo.com`, password: PASSWORD } }).then((r) => r.json<{ id: string }>());
    const a1 = await addEmployee(a, 1);
    await addEmployee(a, 2);
    await addEmployee(a, 3);
    await addEmployee(b, 1);
    await app.inject({ method: 'PATCH', url: `/api/employees/${a1.id}`, headers: bearer(a.accessToken), payload: { active: false } });

    const admin = await makeAdmin({ permissions: ['businesses_view'] });
    const detailA = (await call(admin, 'GET', `/businesses/${a.business.id}`)).json<PlatformBusinessDetail>();
    const detailB = (await call(admin, 'GET', `/businesses/${b.business.id}`)).json<PlatformBusinessDetail>();
    expect(detailA.employees.value).toEqual({ owners: 1, employeesActive: 2, employeesInactive: 1 });
    expect(detailB.employees.value).toEqual({ owners: 1, employeesActive: 1, employeesInactive: 0 });
    expect(detailA.employeeHistory.state).toBe('unavailable');
    expect(detailA.owners[0]!.emailMasked).toBe(`d***@correo.com`);
    const raw = JSON.stringify(detailA);
    expect(raw).not.toContain(a.email);
    expect(raw).not.toMatch(/password|argon2|scrypt|token_hash/i);
    expect(detailA.lastActivityAt.state).toBe('ok');
    const views = await q<{ n: number }>(`select count(*)::int as n from platform_audit_log where action = 'business.view' and business_id = $1`, [a.business.id]);
    expect(views[0]!.n).toBe(1);
    expect((await call(admin, 'GET', `/businesses/${randomUUID()}`)).statusCode).toBe(404);
  });
});

describe('suspensión y reactivación', () => {
  it('bloquea sesiones abiertas, renovación, inicio de sesión y páginas públicas; todo auditado y reversible', async () => {
    const owner = await registerBusiness();
    const admin = await makeAdmin({ permissions: ['business_access_manage', 'businesses_view'] });
    const url = `/businesses/${owner.business.id}`;
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/${owner.business.slug}` })).statusCode).toBe(200);

    expect((await call(admin, 'POST', `${url}/suspend`, { reason: 'corta', confirmSlug: owner.business.slug })).statusCode).toBe(400);
    const mismatch = await call(admin, 'POST', `${url}/suspend`, { reason: 'Uso indebido reportado por soporte', confirmSlug: 'otro-negocio' });
    expect([mismatch.statusCode, mismatch.json().code]).toEqual([422, 'confirmation_mismatch']);
    const res = await call(admin, 'POST', `${url}/suspend`, { reason: 'Uso indebido reportado por soporte', confirmSlug: owner.business.slug });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ from: 'active', to: 'suspended', sessionsRevoked: 1 });
    expect((await call(admin, 'POST', `${url}/suspend`, { reason: 'Uso indebido reportado por soporte', confirmSlug: owner.business.slug })).statusCode).toBe(409);

    const api = await app.inject({ method: 'GET', url: '/api/business', headers: bearer(owner.accessToken) });
    expect([api.statusCode, api.json().code]).toEqual([403, 'business_suspended']);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: owner.refreshToken } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: owner.email, password: PASSWORD } });
    expect([login.statusCode, login.json().code]).toEqual([403, 'business_suspended']);
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/${owner.business.slug}` })).statusCode).toBe(404);
    // La suscripción y los pagos NO se tocan.
    expect((await q(`select * from subscriptions where business_id = $1`, [owner.business.id])).length).toBe(0);

    const [entry] = await q<{ details: Record<string, unknown>; outcome: string; request_id: string }>(`select details, outcome, request_id from platform_audit_log where action = 'business.suspend' and business_id = $1 and outcome = 'success'`, [owner.business.id]);
    expect(entry).toMatchObject({ outcome: 'success', details: { before: { accessStatus: 'active' }, after: { accessStatus: 'suspended' }, reason: 'Uso indebido reportado por soporte', sessionsRevoked: 1 } });
    expect(entry!.request_id).toBeTruthy();

    const back = await call(admin, 'POST', `${url}/reactivate`, { reason: 'Caso resuelto con el cliente', confirmSlug: owner.business.slug });
    expect(back.json()).toMatchObject({ from: 'suspended', to: 'active' });
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: owner.email, password: PASSWORD } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/${owner.business.slug}` })).statusCode).toBe(200);
    const detail = (await call(admin, 'GET', url)).json<PlatformBusinessDetail>();
    expect(detail.history.map((h) => h.action)).toEqual(expect.arrayContaining(['business.suspend', 'business.reactivate']));
  });

  it('con el negocio suspendido no se aceptan reservas, pero el cliente aún ve y cancela SU cita con su enlace', async () => {
    const biz = await setupBiz(app, 'Reservas Suspensión');
    const date = workday(5);
    const booked = await book(app, biz, date, '10:00');
    expect(booked.statusCode).toBe(201);
    const token = booked.json<{ token: string }>().token;
    const founder = await makeAdmin({ founder: true });
    expect((await call(founder, 'POST', `/businesses/${biz.session.business.id}/suspend`, { reason: 'Prueba de reservas con suspensión', confirmSlug: biz.slug })).statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: biz.base })).statusCode).toBe(404);
    expect((await book(app, biz, date, '12:00')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${biz.base}/appointments/${token}/reschedule`, payload: { startsAt: at(date, '15:00') } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${biz.base}/appointments/${token}` })).statusCode).toBe(200);
    const cancelled = await app.inject({ method: 'POST', url: `${biz.base}/appointments/${token}/cancel`, payload: {} });
    expect(cancelled.statusCode).toBe(200);
  });

  it('suspender un negocio no afecta a otro', async () => {
    const a = await registerBusiness();
    const b = await registerBusiness();
    const admin = await makeAdmin({ founder: true });
    await call(admin, 'POST', `/businesses/${a.business.id}/suspend`, { reason: 'Prueba de aislamiento', confirmSlug: a.business.slug });
    expect((await app.inject({ method: 'GET', url: '/api/business', headers: bearer(b.accessToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: b.refreshToken } })).statusCode).toBe(200);
  });
});

describe('extensión de acceso', () => {
  const subscription = async (owner: AuthSession) => (await app.inject({ method: 'GET', url: '/api/subscription', headers: bearer(owner.accessToken) })).json<Subscription>();

  it('da acceso sin tocar la suscripción ni registrar un pago; es idempotente y revocable', async () => {
    const owner = await registerBusiness();
    const admin = await makeAdmin({ permissions: ['business_extend', 'businesses_view'] });
    expect((await subscription(owner)).hasAccess).toBe(false);
    const key = randomUUID();
    const payload = { unit: 'days', amount: 7, reason: 'Compensación por caída del servicio', supportRef: 'TICKET-42', idempotencyKey: key, confirmSlug: owner.business.slug };
    const first = await call(admin, 'POST', `/businesses/${owner.business.id}/grants`, payload);
    expect(first.statusCode).toBe(201);
    const grant = first.json<{ grant: { id: string; startsAt: string; endsAt: string } }>().grant;
    expect(Date.parse(grant.endsAt) - Date.parse(grant.startsAt)).toBe(7 * 86_400_000);
    // Reintento / doble clic: misma clave, mismo resultado, sin duplicar.
    const again = await call(admin, 'POST', `/businesses/${owner.business.id}/grants`, payload);
    expect([again.statusCode, again.json().replayed, again.json().grant.id]).toEqual([200, true, grant.id]);
    expect((await call(admin, 'POST', `/businesses/${owner.business.id}/grants`, { ...payload, amount: 30 })).statusCode).toBe(409);
    expect((await q(`select id from business_access_grants where business_id = $1`, [owner.business.id])).length).toBe(1);

    const sub = await subscription(owner);
    expect(sub).toMatchObject({ status: 'none', hasAccess: true, accessGrantEndsAt: grant.endsAt });
    expect((await q(`select * from subscriptions where business_id = $1`, [owner.business.id])).length).toBe(0);
    expect((await q(`select * from subscription_invoices where business_id = $1`, [owner.business.id])).length).toBe(0);

    expect((await call(admin, 'POST', `/businesses/${owner.business.id}/grants/${grant.id}/revoke`, { reason: 'Concedida por error al negocio equivocado' })).statusCode).toBe(204);
    expect((await subscription(owner)).hasAccess).toBe(false);
    expect((await call(admin, 'POST', `/businesses/${owner.business.id}/grants/${grant.id}/revoke`, { reason: 'Concedida por error al negocio equivocado' })).statusCode).toBe(404);
  });

  it('concesiones simultáneas se encadenan sin solaparse; los meses empiezan al terminar el período pagado', async () => {
    const owner = await registerBusiness();
    const admin = await makeAdmin({ founder: true });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call(admin, 'POST', `/businesses/${owner.business.id}/grants`, { unit: 'days', amount: 2, reason: 'Prueba de concurrencia de concesiones', idempotencyKey: randomUUID(), confirmSlug: owner.business.slug })),
    );
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    const rows = await q<{ starts_at: Date; ends_at: Date }>(`select starts_at, ends_at from business_access_grants where business_id = $1 order by starts_at`, [owner.business.id]);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i]!.starts_at.getTime()).toBe(rows[i - 1]!.ends_at.getTime());
    expect(rows.at(-1)!.ends_at.getTime() - rows[0]!.starts_at.getTime()).toBe(10 * 86_400_000);

    // Negocio con período pagado vigente: el mes de cortesía empieza cuando termina lo pagado (calendario).
    const paid = await registerBusiness();
    await q(`insert into subscriptions (business_id, plan, status, platform, current_period_start, current_period_end, next_billing_at) values ($1, 'monthly', 'active', 'web', now(), '2099-01-31T12:00:00Z', '2099-01-31T12:00:00Z')`, [paid.business.id]);
    const res = await call(admin, 'POST', `/businesses/${paid.business.id}/grants`, { unit: 'months', amount: 1, reason: 'Mes de cortesía por referido', idempotencyKey: randomUUID(), confirmSlug: paid.business.slug });
    expect(res.json().grant).toMatchObject({ startsAt: '2099-01-31T12:00:00.000Z', endsAt: '2099-02-28T12:00:00.000Z' });
    expect((await call(admin, 'POST', `/businesses/${paid.business.id}/grants`, { unit: 'months', amount: 25, reason: 'Fuera del rango permitido', idempotencyKey: randomUUID(), confirmSlug: paid.business.slug })).statusCode).toBe(400);
  });

  it('una concesión no salta una suspensión', async () => {
    const owner = await registerBusiness();
    const admin = await makeAdmin({ founder: true });
    await call(admin, 'POST', `/businesses/${owner.business.id}/grants`, { unit: 'days', amount: 30, reason: 'Cortesía antes de la suspensión', idempotencyKey: randomUUID(), confirmSlug: owner.business.slug });
    await call(admin, 'POST', `/businesses/${owner.business.id}/suspend`, { reason: 'Suspensión con concesión vigente', confirmSlug: owner.business.slug });
    expect((await app.inject({ method: 'GET', url: '/api/subscription', headers: bearer(owner.accessToken) })).statusCode).toBe(403);
    const detail = (await call(admin, 'GET', `/businesses/${owner.business.id}`)).json<PlatformBusinessDetail>();
    expect([detail.grantAccessEndsAt !== null, detail.effectiveAccess]).toEqual([true, false]);
  });
});

describe('baja lógica (desactivación recuperable)', () => {
  it('exige su propio permiso; desactiva sin borrar datos y se puede recuperar', async () => {
    const owner = await registerBusiness();
    await app.inject({ method: 'POST', url: '/api/clients', headers: bearer(owner.accessToken), payload: { name: 'Cliente que debe sobrevivir' } });
    const manager = await makeAdmin({ permissions: ['business_access_manage'] });
    const payload = { reason: 'Solicitud de baja del dueño por correo', confirmSlug: owner.business.slug };
    expect((await call(manager, 'POST', `/businesses/${owner.business.id}/deactivate`, payload)).statusCode).toBe(403);
    const founder = await makeAdmin({ founder: true });
    const res = await call(founder, 'POST', `/businesses/${owner.business.id}/deactivate`, payload);
    expect(res.json()).toMatchObject({ to: 'deactivated' });
    expect((await call(founder, 'POST', `/businesses/${owner.business.id}/reactivate`, payload)).statusCode).toBe(409); // se recupera con "restore"
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: owner.email, password: PASSWORD } })).json().code).toBe('business_suspended');
    expect((await q(`select id from clients where business_id = $1 and name = 'Cliente que debe sobrevivir'`, [owner.business.id])).length).toBe(1);
    const [audit] = await q<{ details: Record<string, unknown> }>(`select details from platform_audit_log where action = 'business.deactivate' and business_id = $1`, [owner.business.id]);
    expect(String(audit!.details.physicalDeletion)).toContain('no_programada');

    expect((await call(founder, 'POST', `/businesses/${owner.business.id}/restore`, { reason: 'El dueño pidió volver', confirmSlug: owner.business.slug })).json()).toMatchObject({ from: 'deactivated', to: 'active' });
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: owner.email, password: PASSWORD } })).statusCode).toBe(200);
  });
});

describe('bitácora de la plataforma', () => {
  it('es de solo inserción: UPDATE, DELETE y TRUNCATE fallan', async () => {
    await makeAdmin({ permissions: ['metrics_view'] });
    await expect(q(`update platform_audit_log set outcome = 'success'`)).rejects.toThrow(/solo inserci/);
    await expect(q(`delete from platform_audit_log`)).rejects.toThrow(/solo inserci/);
    await expect(q(`truncate platform_audit_log`)).rejects.toThrow(/solo inserci/);
  });

  it('se consulta paginada con su permiso, y nunca guarda contraseñas, tokens ni códigos', async () => {
    const admin = await makeAdmin({ permissions: ['audit_view'] });
    const page = await call(admin, 'GET', '/audit');
    expect(page.statusCode).toBe(200);
    const body = page.json<{ entries: Array<{ action: string }>; nextBefore: string | null }>();
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.length).toBeLessThanOrEqual(50);
    const all = JSON.stringify(await q(`select * from platform_audit_log`));
    expect(all).not.toContain(admin.password);
    expect(all).not.toContain(admin.token);
    expect(all).not.toMatch(/xpa_[A-Za-z0-9_-]{20,}/);
  });
});
