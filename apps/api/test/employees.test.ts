import { EMPLOYEE_PERMISSIONS, type AuditLogEntry, type AuthSession, type Employee, type EmployeePermission, type Item, type Subscription, type User } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertPolicyCovers, authorize, POLICY } from '../src/authz';
import { buildApp } from '../src/app';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig({ corsOrigins: ['http://localhost:8081'] });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const PASSWORD = 'Secreta123';
let counter = 0;

async function register(): Promise<AuthSession> {
  counter += 1;
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Dueña', businessName: `Studio Emp ${counter}`, businessType: 'beauty_salon', email: `owner${counter}@correo.com`, password: PASSWORD, acceptTerms: true, language: 'es' } });
  expect(res.statusCode).toBe(201);
  return res.json<AuthSession>();
}
const auth = (session: { accessToken: string }) => ({ authorization: `Bearer ${session.accessToken}` });

/** Crea un empleado con esos permisos y devuelve su sesión ya iniciada. */
async function createEmployee(owner: AuthSession, permissions: EmployeePermission[] = [], overrides: Record<string, unknown> = {}) {
  counter += 1;
  const email = `emp${counter}@correo.com`;
  const created = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(owner), payload: { name: 'Carlos Empleado', email, password: PASSWORD, permissions, ...overrides } });
  expect(created.statusCode).toBe(201);
  const employee = created.json<Employee>();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: PASSWORD } });
  expect(login.statusCode).toBe(200);
  return { employee, session: login.json<AuthSession>(), email };
}

async function firstCategoryId(session: AuthSession): Promise<string> {
  return (await app.inject({ method: 'GET', url: '/api/categories', headers: auth(session) })).json<Array<{ id: string }>>()[0]!.id;
}
async function createItem(session: AuthSession): Promise<Item> {
  const res = await app.inject({ method: 'POST', url: '/api/items', headers: auth(session), payload: { name: 'Corte', categoryId: await firstCategoryId(session), price: 30000, internalUnitCost: 12000, internalNotes: 'NOTA-SECRETA', stock: 3 } });
  expect(res.statusCode).toBe(201);
  return res.json<Item>();
}
async function createClient(session: AuthSession, name = 'Marta Ríos'): Promise<{ id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json();
}
const status = async (session: { accessToken: string }, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  (await app.inject({ method, url, headers: auth(session), payload: payload as object | undefined })).statusCode;

describe('gestión de empleados (dueño)', () => {
  it('crea, lista y muestra al empleado con permisos normalizados; el dueño se ve con todos', async () => {
    const owner = await register();
    const { employee, session } = await createEmployee(owner, ['services_record']);
    expect(employee).toMatchObject({ name: 'Carlos Empleado', active: true, permissions: ['clients_view', 'catalog_view', 'services_record'] }); // lo implícito se agrega
    expect(JSON.stringify(employee)).not.toContain('passwordHash');

    const list = await app.inject({ method: 'GET', url: '/api/employees', headers: auth(owner) });
    expect(list.json<Employee[]>().map((e) => e.id)).toEqual([employee.id]); // el dueño no aparece en su propia lista de empleados

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(session) });
    expect(me.json<{ user: User }>().user).toMatchObject({ role: 'employee', permissions: ['clients_view', 'catalog_view', 'services_record'], businessId: owner.business.id });
    const ownerMe = await app.inject({ method: 'GET', url: '/api/me', headers: auth(owner) });
    expect(ownerMe.json<{ user: User }>().user).toMatchObject({ role: 'owner' });
    expect(ownerMe.json<{ user: User }>().user.permissions).toHaveLength(EMPLOYEE_PERMISSIONS.length);
  });

  it('valida: exige correo o celular, contraseña fuerte, y rechaza duplicados', async () => {
    const owner = await register();
    const noContact = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(owner), payload: { name: 'Sin contacto', password: PASSWORD } });
    expect(noContact.statusCode).toBe(400);
    const weak = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(owner), payload: { name: 'Débil', email: 'debil@correo.com', password: 'abc' } });
    expect(weak.statusCode).toBe(400);
    const { email } = await createEmployee(owner);
    const dup = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(owner), payload: { name: 'Repetido', email, password: PASSWORD } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('account_exists');
  });

  it('un permiso desconocido en la petición se rechaza (no se puede inventar uno)', async () => {
    const owner = await register();
    const res = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(owner), payload: { name: 'X', email: 'x@correo.com', password: PASSWORD, permissions: ['admin', 'business_settings'] } });
    expect(res.statusCode).toBe(400);
  });

  it('actualiza nombre y permisos, y el cambio aplica de inmediato con el MISMO token', async () => {
    const owner = await register();
    const { employee, session } = await createEmployee(owner, []);
    expect(await status(session, 'GET', '/api/clients')).toBe(403);
    const patched = await app.inject({ method: 'PATCH', url: `/api/employees/${employee.id}`, headers: auth(owner), payload: { name: 'Carlos R.', permissions: ['clients_manage'] } });
    expect(patched.json<Employee>()).toMatchObject({ name: 'Carlos R.', permissions: ['clients_view', 'clients_manage'] });
    expect(await status(session, 'GET', '/api/clients')).toBe(200);
    await app.inject({ method: 'PATCH', url: `/api/employees/${employee.id}`, headers: auth(owner), payload: { permissions: [] } });
    expect(await status(session, 'GET', '/api/clients')).toBe(403); // y se revoca igual de rápido
  });

  it('desactivar cierra el acceso: token vigente, refresh y nuevo login quedan bloqueados; reactivar lo devuelve', async () => {
    const owner = await register();
    const { employee, session, email } = await createEmployee(owner, ['clients_view']);
    expect(await status(session, 'GET', '/api/clients')).toBe(200);

    await app.inject({ method: 'PATCH', url: `/api/employees/${employee.id}`, headers: auth(owner), payload: { active: false } });
    expect(await status(session, 'GET', '/api/clients')).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: PASSWORD } });
    expect(login.statusCode).toBe(403);
    expect(login.json().code).toBe('account_disabled');
    // Con contraseña incorrecta sigue siendo "credenciales incorrectas": no revela qué cuentas existen.
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'Otra12345' } });
    expect(wrong.json().code).toBe('invalid_credentials');

    await app.inject({ method: 'PATCH', url: `/api/employees/${employee.id}`, headers: auth(owner), payload: { active: true } });
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: PASSWORD } })).statusCode).toBe(200);
  });

  it('el dueño puede restablecer la contraseña: la vieja y las sesiones abiertas dejan de servir', async () => {
    const owner = await register();
    const { employee, session, email } = await createEmployee(owner, ['clients_view']);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // el token debe ser anterior al cambio (resolución de 1 s)
    const reset = await app.inject({ method: 'PATCH', url: `/api/employees/${employee.id}`, headers: auth(owner), payload: { password: 'Nueva12345' } });
    expect(reset.statusCode).toBe(200);
    expect(await status(session, 'GET', '/api/clients')).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: PASSWORD } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'Nueva12345' } })).statusCode).toBe(200);
  });
});

describe('qué puede hacer un empleado', () => {
  it('sin permisos: solo su cuenta, datos básicos del negocio y si hay acceso', async () => {
    const owner = await register();
    const { session } = await createEmployee(owner, []);
    expect(await status(session, 'GET', '/api/me')).toBe(200);
    expect(await status(session, 'GET', '/api/business')).toBe(200);
    expect(await status(session, 'GET', '/api/subscription')).toBe(200);
    for (const [method, url] of [
      ['GET', '/api/clients'],
      ['GET', '/api/items'],
      ['GET', '/api/categories'],
      ['GET', '/api/service-records'],
      ['GET', '/api/loyalty/clients'],
      ['GET', '/api/loyalty/program'],
    ] as const) {
      expect(await status(session, method, url), `${method} ${url}`).toBe(403);
    }
  });

  it('con clients_view solo lee; con clients_manage también crea, edita y borra', async () => {
    const owner = await register();
    const client = await createClient(owner);
    const viewer = await createEmployee(owner, ['clients_view']);
    expect(await status(viewer.session, 'GET', '/api/clients')).toBe(200);
    expect(await status(viewer.session, 'GET', `/api/clients/${client.id}`)).toBe(200);
    expect(await status(viewer.session, 'POST', '/api/clients', { name: 'Nuevo' })).toBe(403);
    expect(await status(viewer.session, 'PUT', `/api/clients/${client.id}`, { name: 'Cambio' })).toBe(403);
    expect(await status(viewer.session, 'DELETE', `/api/clients/${client.id}`)).toBe(403);
    expect(await status(viewer.session, 'POST', `/api/clients/${client.id}/anonymize`)).toBe(403);

    const manager = await createEmployee(owner, ['clients_manage']);
    expect(await status(manager.session, 'POST', '/api/clients', { name: 'Nuevo' })).toBe(201);
    expect(await status(manager.session, 'PUT', `/api/clients/${client.id}`, { name: 'Cambio' })).toBe(200);
    expect(await status(manager.session, 'POST', `/api/clients/${client.id}/anonymize`)).toBe(200);
    expect(await status(manager.session, 'DELETE', `/api/clients/${client.id}`)).toBe(204);
  });

  it('lo del dueño sigue cerrado incluso con TODOS los permisos: negocio, caja, plan, notificaciones, equipo y bitácora', async () => {
    const owner = await register();
    const all: EmployeePermission[] = ['clients_view', 'clients_manage', 'catalog_view', 'catalog_manage', 'services_record', 'loyalty_redeem'];
    const { session, employee } = await createEmployee(owner, all);
    const ownerOnly: Array<[('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'), string, unknown?]> = [
      ['PATCH', '/api/business', { name: 'Robado' }],
      ['PUT', '/api/business/logo'],
      ['GET', '/api/cash/today'],
      ['POST', '/api/cash/opening', { amount: 1 }],
      ['PUT', '/api/loyalty/program', { enabled: true, goal: 1, itemIds: [] }],
      ['POST', '/api/subscription/trial', { plan: 'monthly', platform: 'web' }],
      ['POST', '/api/subscription/checkout/stripe', { plan: 'monthly' }],
      ['POST', '/api/subscription/checkout/paypal', { plan: 'monthly' }],
      ['POST', '/api/subscription/checkout/bank-transfer', { plan: 'monthly' }],
      ['POST', '/api/subscription/cancel'],
      ['GET', '/api/notifications/settings'],
      ['PUT', '/api/notifications/settings', { enabled: true, loyaltyEnabled: true, billingEnabled: true }],
      // (registrar y probar SUS dispositivos push ya es de cualquier persona con sesión: ver booking.staff.test.ts)
      ['GET', '/api/employees'],
      ['POST', '/api/employees', { name: 'X', email: 'x@correo.com', password: PASSWORD }],
      ['PATCH', `/api/employees/${employee.id}`, { permissions: [] }],
      ['GET', '/api/audit-logs'],
    ];
    for (const [method, url, payload] of ownerOnly) expect(await status(session, method, url, payload), `${method} ${url}`).toBe(403);
    // Y el negocio no cambió.
    const business = await app.inject({ method: 'GET', url: '/api/business', headers: auth(owner) });
    expect(business.json().name).toBe(owner.business.name);
  });

  it('no puede ascenderse: PATCH /me ignora rol y permisos', async () => {
    const owner = await register();
    const { session } = await createEmployee(owner, []);
    await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(session), payload: { name: 'Carlos', role: 'owner', permissions: ['catalog_manage'], active: true } });
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(session) })).json<{ user: User }>().user;
    expect(me).toMatchObject({ role: 'employee', permissions: [], name: 'Carlos' });
    expect(await status(session, 'GET', '/api/items')).toBe(403);
  });

  it('el costo y las notas internas solo los ve quien gestiona el catálogo', async () => {
    const owner = await register();
    const item = await createItem(owner);
    const viewer = await createEmployee(owner, ['catalog_view']);
    const seen = (await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers: auth(viewer.session) })).json<Item>();
    expect(seen).toMatchObject({ name: 'Corte', price: 30000, internalUnitCost: 0, internalNotes: '' });
    const list = (await app.inject({ method: 'GET', url: '/api/items', headers: auth(viewer.session) })).json<Item[]>();
    expect(JSON.stringify(list)).not.toContain('NOTA-SECRETA');

    const manager = await createEmployee(owner, ['catalog_manage']);
    const full = (await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers: auth(manager.session) })).json<Item>();
    expect(full).toMatchObject({ internalUnitCost: 12000, internalNotes: 'NOTA-SECRETA' });
  });

  it('del plan solo ve si hay acceso: sin plan, precios ni método de pago', async () => {
    const owner = await register();
    await app.inject({ method: 'POST', url: '/api/subscription/trial', headers: auth(owner), payload: { plan: 'yearly', platform: 'web' } });
    const { session } = await createEmployee(owner, []);
    const sub = (await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) })).json<Subscription>();
    expect(sub).toMatchObject({ status: 'trial', hasAccess: true, plan: null, paymentMethod: null, trialEndsAt: null, currentPeriodEnd: null, nextBillingAt: null });
    const ownerSub = (await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(owner) })).json<Subscription>();
    expect(ownerSub.plan).toBe('yearly');
  });

  it('un empleado con services_record registra un servicio y suma el sello, pero no canjea sin loyalty_redeem', async () => {
    const owner = await register();
    const item = await createItem(owner);
    const client = await createClient(owner);
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(owner), payload: { enabled: true, goal: 1, resetOnRedeem: true, rewardMessage: '', itemIds: [item.id] } });
    const worker = await createEmployee(owner, ['services_record']);
    const record = await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(worker.session), payload: { clientId: client.id, itemId: item.id } });
    expect(record.statusCode).toBe(201);
    expect(record.json()).toMatchObject({ rewardJustEarned: true });
    expect(await status(worker.session, 'GET', '/api/loyalty/clients')).toBe(200); // ve el progreso para elegir a quién registrar...
    expect(await status(worker.session, 'GET', '/api/loyalty/redemptions')).toBe(403); // ...pero no el historial de canjes
    expect(await status(worker.session, 'POST', `/api/loyalty/clients/${client.id}/redeem`)).toBe(403);
    const cashier = await createEmployee(owner, ['loyalty_redeem']);
    expect(await status(cashier.session, 'POST', `/api/loyalty/clients/${client.id}/redeem`)).toBe(200);
  });
});

describe('aislamiento entre negocios', () => {
  it('un dueño no ve ni toca empleados de otro negocio, y un empleado no ve datos de otro negocio', async () => {
    const ownerA = await register();
    const ownerB = await register();
    const a = await createEmployee(ownerA, ['clients_manage', 'catalog_manage']);
    const b = await createEmployee(ownerB, ['clients_manage']);
    const clientB = await createClient(ownerB, 'Cliente de B');

    expect((await app.inject({ method: 'GET', url: '/api/employees', headers: auth(ownerA) })).json<Employee[]>().map((e) => e.id)).toEqual([a.employee.id]);
    expect(await status(ownerB, 'PATCH', `/api/employees/${a.employee.id}`, { active: false })).toBe(404);
    expect(await status(a.session, 'GET', '/api/clients')).toBe(200);
    const clientsSeenByA = (await app.inject({ method: 'GET', url: '/api/clients', headers: auth(a.session) })).json<Array<{ id: string }>>();
    expect(clientsSeenByA.map((c) => c.id)).not.toContain(clientB.id);
    expect(await status(a.session, 'GET', `/api/clients/${clientB.id}`)).toBe(404);
    expect(await status(a.session, 'PUT', `/api/clients/${clientB.id}`, { name: 'Hackeado' })).toBe(404);
    expect(await status(a.session, 'DELETE', `/api/clients/${clientB.id}`)).toBe(404);
    // El empleado de A sigue activo: B nunca pudo desactivarlo.
    expect(await status(a.session, 'GET', '/api/me')).toBe(200);
    void b;
  });

  it('el dueño no puede gestionar a otro dueño ni a sí mismo por la ruta de empleados', async () => {
    const owner = await register();
    const other = await register();
    expect(await status(owner, 'PATCH', `/api/employees/${owner.user.id}`, { active: false })).toBe(404);
    expect(await status(owner, 'PATCH', `/api/employees/${other.user.id}`, { active: false })).toBe(404);
    expect(await status(owner, 'GET', '/api/me')).toBe(200);
  });
});

describe('bitácora de auditoría', () => {
  it('registra escrituras y accesos denegados del empleado (no las lecturas), y solo el dueño de ese negocio la ve', async () => {
    const owner = await register();
    const { session, employee } = await createEmployee(owner, ['clients_manage']);
    await app.inject({ method: 'GET', url: '/api/clients', headers: auth(session) }); // lectura: no se registra
    const created = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name: 'Nueva clienta' } });
    const clientId = created.json<{ id: string }>().id;
    await app.inject({ method: 'PUT', url: `/api/clients/${clientId}`, headers: auth(session), payload: { name: 'Nueva clienta 2' } });
    await app.inject({ method: 'GET', url: '/api/cash/today', headers: auth(session) }); // denegado: sí se registra

    const fetchLogs = async () => (await app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth(owner) })).json<AuditLogEntry[]>();
    // onResponse corre después de responder: se espera a que la bitácora se escriba en vez de asumir el orden.
    await vi.waitFor(async () => expect((await fetchLogs()).filter((l) => l.userId === employee.id)).toHaveLength(3));
    const logs = await fetchLogs();
    const mine = logs.filter((l) => l.userId === employee.id);
    expect(mine.map((l) => `${l.action}|${l.status}`).sort()).toEqual(['GET /cash/today|403', 'POST /clients|201', 'PUT /clients/:id|200']);
    expect(mine.find((l) => l.action === 'PUT /clients/:id')).toMatchObject({ entityId: clientId, userName: 'Carlos Empleado' });
    expect(JSON.stringify(logs)).not.toContain('Nueva clienta'); // ni cuerpos ni datos personales

    const filtered = (await app.inject({ method: 'GET', url: `/api/audit-logs?userId=${employee.id}&limit=1`, headers: auth(owner) })).json<AuditLogEntry[]>();
    expect(filtered).toHaveLength(1);

    const stranger = await register();
    expect((await app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth(stranger) })).json()).toEqual([]);
    expect(await status(session, 'GET', '/api/audit-logs')).toBe(403);
  });

  it('también deja constancia de la gestión de empleados hecha por el dueño', async () => {
    const owner = await register();
    const { employee } = await createEmployee(owner, []);
    await app.inject({ method: 'PATCH', url: `/api/employees/${employee.id}`, headers: auth(owner), payload: { active: false } });
    const logs = (await app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth(owner) })).json<AuditLogEntry[]>();
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['POST /employees', 'PATCH /employees/:id']));
    expect(logs.every((l) => l.userName === 'Dueña')).toBe(true);
  });
});

describe('política de acceso (por defecto, denegar)', () => {
  it('toda entrada de POLICY tiene forma válida y una ruta desconocida no la puede usar un empleado', () => {
    for (const key of Object.keys(POLICY)) expect(key).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
    const employee = { role: 'employee' as const, permissions: ['catalog_manage' as const] };
    expect(() => authorize(employee, 'GET', '/api/ruta-nueva-sin-politica')).toThrowError(/forbidden/);
    expect(() => authorize({ role: 'owner', permissions: [] }, 'GET', '/api/ruta-nueva-sin-politica')).not.toThrow();
  });

  it('una ruta autenticada sin política impide arrancar la app', () => {
    expect(() => assertPolicyCovers('GET', '/api/ruta-nueva-sin-politica')).toThrowError(/sin política/);
    expect(() => assertPolicyCovers('HEAD', '/api/items')).not.toThrow();
    expect(() => assertPolicyCovers('GET', '/api/items')).not.toThrow();
  });

  it('exige sesión en todas las rutas de empleados', async () => {
    for (const req of [
      { method: 'GET' as const, url: '/api/employees' },
      { method: 'POST' as const, url: '/api/employees' },
      { method: 'PATCH' as const, url: '/api/employees/00000000-0000-0000-0000-000000000000' },
      { method: 'PUT' as const, url: '/api/employees/00000000-0000-0000-0000-000000000000/photo' },
      { method: 'DELETE' as const, url: '/api/employees/00000000-0000-0000-0000-000000000000/photo' },
      { method: 'GET' as const, url: '/api/audit-logs' },
    ]) {
      expect((await app.inject(req)).statusCode).toBe(401);
    }
  });
});
