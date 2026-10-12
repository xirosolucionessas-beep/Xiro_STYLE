import type { AppointmentDto, AuthSession } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { at, auth, createEmployee, firstCategoryId, nextPhone, PASSWORD, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  // exposeDevOtp: la prueba de "seguridad" necesita leer el código de recuperación para completar el flujo sin un canal real de SMS/correo.
  const { config, cleanup } = testAppConfig({ exposeDevOtp: true });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const send = (session: { accessToken: string }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => app.inject({ method, url, headers: auth(session), payload: payload as object | undefined });

const staffBody = (biz: Biz, professionalId: string, date: string, time: string) => ({
  professionalId,
  startsAt: at(date, time),
  selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [] },
  newClient: { name: 'Cliente Mostrador', phone: nextPhone() },
});

/** Negocio con un empleado ("Luis") agendable, además del dueño. */
async function withLuis(biz: Biz) {
  const luis = await createEmployee(app, biz.session, ['agenda_own']);
  expect((await send(biz.session, 'PATCH', `/api/professionals/${luis.employee.id}`, { bookable: true, publicName: 'Luis' })).statusCode).toBe(200);
  return luis;
}

/** El dueño agenda EN NOMBRE del profesional (Luis): así `notifyAppointment` tiene a quién avisar. */
async function bookForLuis(app: FastifyInstance, biz: Biz, luisId: string, date: string, time: string): Promise<AppointmentDto> {
  const res = await send(biz.session, 'POST', '/api/appointments', staffBody(biz, luisId, date, time));
  expect(res.statusCode).toBe(201);
  return res.json<AppointmentDto>();
}

type NotificationRow = { id: string; category: string; titleKey: string; href: string | null; read: boolean };

/**
 * `notifyBusiness`/`notifyUser`/`notifyAppointment` son de "mejor esfuerzo" A PROPÓSITO (ver push.ts): la ruta
 * responde sin esperarlos, así que leer el centro justo después de la acción que los dispara es una carrera real,
 * no solo en teoría. Mismo patrón que ya usan las pruebas de push de facturación (`vi.waitFor`) para el envío real;
 * aquí, para lo guardado en el centro.
 */
async function waitForNotifications(session: { accessToken: string }, atLeast: number): Promise<{ notifications: NotificationRow[]; unread: number }> {
  let result!: { notifications: NotificationRow[]; unread: number };
  await vi.waitFor(async () => {
    result = (await send(session, 'GET', '/api/notifications')).json<{ notifications: NotificationRow[]; unread: number }>();
    expect(result.notifications.length).toBeGreaterThanOrEqual(atLeast);
  });
  return result;
}

describe('centro de notificaciones (GET /notifications, marcar leída, marcar todas)', () => {
  it('una cita nueva agendada por el dueño EN NOMBRE del profesional queda en el centro del profesional, no en el del dueño', async () => {
    const biz = await setupBiz(app, 'Centro');
    const luis = await withLuis(biz);
    const date = workday(4);
    await bookForLuis(app, biz, luis.employee.id, date, '09:00');

    const mine = await waitForNotifications(luis.session, 1);
    expect(mine.unread).toBe(1);
    expect(mine.notifications).toMatchObject([{ category: 'appointments', titleKey: 'push_appt_new_title', href: '/agenda', read: false }]);

    const ownerList = (await send(biz.session, 'GET', '/api/notifications')).json<{ notifications: unknown[]; unread: number }>();
    expect(ownerList.notifications).toHaveLength(0);
    expect(ownerList.unread).toBe(0);
  });

  it('una sola cita creada produce UNA sola notificación (sin duplicados), y marcarla leída la quita del contador', async () => {
    const biz = await setupBiz(app, 'Centro');
    const luis = await withLuis(biz);
    const date = workday(4);
    await bookForLuis(app, biz, luis.employee.id, date, '09:00');

    const before = await waitForNotifications(luis.session, 1);
    expect(before.notifications).toHaveLength(1);
    expect(before.unread).toBe(1);

    const markRead = await send(luis.session, 'POST', `/api/notifications/${before.notifications[0]!.id}/read`);
    expect(markRead.statusCode).toBe(200);
    expect(markRead.json<{ read: boolean }>().read).toBe(true);

    const after = (await send(luis.session, 'GET', '/api/notifications')).json<{ notifications: Array<{ read: boolean }>; unread: number }>();
    expect(after.notifications).toHaveLength(1);
    expect(after.unread).toBe(0);
    expect(after.notifications[0]!.read).toBe(true);
  });

  it('nadie puede marcar como leída una notificación que no es suya (404, nunca filtra ni toca la del otro)', async () => {
    const biz = await setupBiz(app, 'Centro');
    const luis = await withLuis(biz);
    const date = workday(4);
    await bookForLuis(app, biz, luis.employee.id, date, '09:00');
    const [notif] = (await waitForNotifications(luis.session, 1)).notifications;

    const res = await send(biz.session, 'POST', `/api/notifications/${notif!.id}/read`);
    expect(res.statusCode).toBe(404);

    const stillUnread = (await send(luis.session, 'GET', '/api/notifications')).json<{ unread: number }>();
    expect(stillUnread.unread).toBe(1);
  });

  it('marcar todas como leídas limpia el contador aunque haya varias', async () => {
    const biz = await setupBiz(app, 'Centro');
    const luis = await withLuis(biz);
    const date = workday(4);
    await bookForLuis(app, biz, luis.employee.id, date, '09:00');
    await bookForLuis(app, biz, luis.employee.id, date, '11:00');

    const before = await waitForNotifications(luis.session, 2);
    expect(before.unread).toBe(2);

    const res = await send(luis.session, 'POST', '/api/notifications/read-all');
    expect(res.statusCode).toBe(200);

    const after = (await send(luis.session, 'GET', '/api/notifications')).json<{ notifications: Array<{ read: boolean }>; unread: number }>();
    expect(after.unread).toBe(0);
    expect(after.notifications.every((n) => n.read)).toBe(true);
  });

  it('reagendar la misma cita dos veces a la misma hora (reintento típico de UI) no duplica el aviso de reprogramación', async () => {
    const biz = await setupBiz(app, 'Centro');
    const luis = await withLuis(biz);
    const date = workday(4);
    const appt = await bookForLuis(app, biz, luis.employee.id, date, '09:00');
    await waitForNotifications(luis.session, 1); // espera el aviso de "cita nueva" antes de limpiarlo
    await send(luis.session, 'POST', '/api/notifications/read-all'); // limpia el aviso de "cita nueva" para medir solo el de reprogramar

    const newTime = at(date, '14:00');
    const patch1 = await app.inject({ method: 'PATCH', url: `/api/appointments/${appt.id}`, headers: auth(biz.session), payload: { startsAt: newTime } });
    expect(patch1.statusCode).toBe(200);
    // Reenviar el mismo cambio (mismo horario destino) no debe producir una segunda notificación con la misma clave.
    const patch2 = await app.inject({ method: 'PATCH', url: `/api/appointments/${appt.id}`, headers: auth(biz.session), payload: { startsAt: newTime } });
    expect(patch2.statusCode).toBe(200);

    const list = await waitForNotifications(luis.session, 1);
    const reschedules = list.notifications.filter((n) => n.titleKey === 'push_appt_rescheduled_title');
    expect(reschedules).toHaveLength(1);
  });
});

/** Igual que `toMatchObject` sobre toda la lista, pero más legible cuando solo importan `category`/`titleKey`. */
const categories = (notifications: ReadonlyArray<{ category: string }>) => notifications.map((n) => n.category);

describe('clientes y ventas avisan al dueño (salvo que el dueño sea quien lo hizo)', () => {
  it('un empleado que registra un cliente nuevo avisa al dueño; el dueño registrando uno él mismo no se avisa a sí mismo', async () => {
    const biz = await setupBiz(app, 'Clientes');
    const luis = await createEmployee(app, biz.session, ['clients_manage']);

    expect((await send(luis.session, 'POST', '/api/clients', { name: 'Cliente de Luis' })).statusCode).toBe(201);
    const afterEmployee = await waitForNotifications(biz.session, 1);
    expect(afterEmployee.notifications).toMatchObject([{ category: 'clients', titleKey: 'push_client_new_title' }]);
    expect(afterEmployee.notifications[0]!.href).toMatch(/^\/client\//);

    expect((await send(biz.session, 'POST', '/api/clients', { name: 'Cliente del dueño' })).statusCode).toBe(201);
    const afterOwner = (await send(biz.session, 'GET', '/api/notifications')).json<{ notifications: unknown[] }>();
    expect(afterOwner.notifications).toHaveLength(1); // sigue siendo solo la del empleado: el dueño no se avisa a sí mismo
  });

  it('una venta registrada por un empleado avisa al dueño con el monto; una venta del dueño no se avisa a sí mismo', async () => {
    const biz = await setupBiz(app, 'Ventas');
    const luis = await createEmployee(app, biz.session, ['services_record']);
    const line = { kind: 'service' as const, name: 'Lavado', unitPrice: 15_000, quantity: 1 };

    const sale = await send(luis.session, 'POST', '/api/sales', { lines: [line], payments: [{ method: 'cash', amount: 15_000 }] });
    expect(sale.statusCode).toBe(201);
    const afterEmployee = await waitForNotifications(biz.session, 1);
    expect(afterEmployee.notifications).toMatchObject([{ category: 'sales', titleKey: 'push_sale_new_title' }]);

    expect((await send(biz.session, 'POST', '/api/sales', { lines: [line], payments: [{ method: 'cash', amount: 15_000 }] })).statusCode).toBe(201);
    const afterOwner = (await send(biz.session, 'GET', '/api/notifications')).json<{ notifications: unknown[] }>();
    expect(afterOwner.notifications).toHaveLength(1); // la del dueño no se agrega: no se avisa a sí mismo
  });
});

describe('inventario: avisa al dueño aunque sea él mismo quien ajuste el stock, y nunca duplica el mismo estado', () => {
  it('una venta que agota un producto avisa; bajar más (ya en 0) no puede pasar, y volver a caer en el MISMO estado no repite el aviso', async () => {
    const biz = await setupBiz(app, 'Inventario');
    const categoryId = await firstCategoryId(app, biz.session);
    const product = (
      await send(biz.session, 'POST', '/api/items', { name: 'Shampoo', categoryId, price: 20_000, kind: 'product', stock: 6 })
    ).json<{ id: string }>();

    // 6 → 1: 'reorder' (primer aviso).
    expect((await send(biz.session, 'POST', `/api/items/${product.id}/stock-adjustments`, { delta: -5 })).statusCode).toBe(200);
    // 1 → 0: 'out_of_stock' (segundo aviso, distinto del anterior: cayó más).
    expect((await send(biz.session, 'POST', `/api/items/${product.id}/stock-adjustments`, { delta: -1 })).statusCode).toBe(200);
    // 0 → 1: vuelve a 'reorder' — MISMO estado que el primer aviso: no debe repetirse.
    expect((await send(biz.session, 'POST', `/api/items/${product.id}/stock-adjustments`, { delta: 1 })).statusCode).toBe(200);

    const list = await waitForNotifications(biz.session, 2);
    const inventory = list.notifications.filter((n) => n.category === 'inventory');
    expect(inventory).toHaveLength(2); // 'reorder' una vez, 'out_of_stock' una vez — no 3
    expect(inventory.map((n) => n.titleKey).sort()).toEqual(['push_inventory_low_title', 'push_inventory_out_title']);
  });

  it('el propio dueño ajustando SU PROPIO stock sí se avisa a sí mismo (es información de inventario, no "algo que ya hizo")', async () => {
    const biz = await setupBiz(app, 'Inventario');
    const categoryId = await firstCategoryId(app, biz.session);
    const product = (await send(biz.session, 'POST', '/api/items', { name: 'Cera', categoryId, price: 10_000, kind: 'product', stock: 2 })).json<{ id: string }>();
    expect((await send(biz.session, 'POST', `/api/items/${product.id}/stock-adjustments`, { delta: -2 })).statusCode).toBe(200);

    const list = await waitForNotifications(biz.session, 1);
    expect(categories(list.notifications)).toContain('inventory');
  });
});

describe('empleados: cambios de permiso y reactivación avisan al empleado, no al dueño', () => {
  it('cambiar los permisos de un empleado le avisa a ÉL; desactivarlo no le avisa (no podría verlo: no puede volver a iniciar sesión)', async () => {
    const biz = await setupBiz(app, 'Equipo');
    const luis = await createEmployee(app, biz.session, ['clients_manage']);

    expect((await send(biz.session, 'PATCH', `/api/employees/${luis.employee.id}`, { permissions: ['clients_manage', 'catalog_view'] })).statusCode).toBe(200);
    const afterPermChange = await waitForNotifications(luis.session, 1);
    expect(afterPermChange.notifications).toMatchObject([{ category: 'employees', titleKey: 'push_employee_permissions_title' }]);

    expect((await send(biz.session, 'PATCH', `/api/employees/${luis.employee.id}`, { active: false })).statusCode).toBe(200);
    // Ya no tiene sesión válida (se le cerraron los tokens): no hay forma de comprobar su centro, pero tampoco debe
    // haber aparecido nada nuevo en el del DUEÑO (estos avisos son solo del empleado).
    const ownerList = (await send(biz.session, 'GET', '/api/notifications')).json<{ notifications: unknown[] }>();
    expect(ownerList.notifications).toHaveLength(0);
  });

  it('reactivar a un empleado le avisa a él', async () => {
    const biz = await setupBiz(app, 'Equipo');
    const luis = await createEmployee(app, biz.session, []);
    expect((await send(biz.session, 'PATCH', `/api/employees/${luis.employee.id}`, { active: false })).statusCode).toBe(200);
    expect((await send(biz.session, 'PATCH', `/api/employees/${luis.employee.id}`, { active: true })).statusCode).toBe(200);

    // Reactivado: ya puede iniciar sesión de nuevo y ver el aviso.
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: luis.employee.email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const session = login.json<AuthSession>();
    const list = await waitForNotifications(session, 1);
    expect(list.notifications).toMatchObject([{ category: 'employees', titleKey: 'push_employee_reactivated_title' }]);
  });
});

describe('seguridad: restablecer la contraseña avisa a esa persona', () => {
  it('después de /auth/recover/reset, la persona ve un aviso de seguridad al volver a iniciar sesión', async () => {
    const biz = await setupBiz(app, 'Seguridad');
    const email = biz.session.user.email!;

    const requested = await app.inject({ method: 'POST', url: '/api/auth/recover/request', payload: { identifier: email, channel: 'email' } });
    const { devCode } = requested.json<{ devCode: string }>();
    const verified = await app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier: email, code: devCode } });
    const { resetToken } = verified.json<{ resetToken: string }>();
    const reset = await app.inject({ method: 'POST', url: '/api/auth/recover/reset', payload: { resetToken, newPassword: 'NuevaClave123' } });
    expect(reset.statusCode).toBe(200);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'NuevaClave123' } });
    expect(login.statusCode).toBe(200);
    const session = login.json<AuthSession>();
    const list = await waitForNotifications(session, 1);
    expect(list.notifications).toMatchObject([{ category: 'security', titleKey: 'push_security_password_changed_title' }]);
  });
});

describe('Web Push: solo servicios de push reales (Fase 3, SSRF)', () => {
  it('registrar un endpoint interno o arbitrario → 400; el de un navegador real se acepta', async () => {
    const biz = await setupBiz(app, 'PushSSRF');
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    for (const endpoint of ['http://169.254.169.254/latest/meta-data/', 'https://localhost:3000/api/admin', 'https://intranet.empresa.local/x']) {
      const res = await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(biz.session), payload: { platform: 'web', endpoint, keys } });
      expect(res.statusCode, endpoint).toBe(400);
    }
    const ok = await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(biz.session), payload: { platform: 'web', endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys } });
    expect(ok.statusCode).toBeLessThan(300);
  });
});
