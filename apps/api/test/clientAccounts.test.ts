import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { hashToken } from '../src/booking/appointments';
import { appointments, clientAccounts, loyaltyProgress } from '../src/db/schema';
import { book, nextPhone, publicPayload, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig({ exposeDevOtp: true });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

/** Cookie de sesión (`xpc=...`) tal como la manda `Set-Cookie`, lista para reenviarla en `Cookie`. */
function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== 'string') throw new Error('se esperaba Set-Cookie');
  return value.split(';')[0]!;
}

const register = (biz: Biz, over: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Cliente Prueba', phone: nextPhone(), password: 'Clavesegura1', acceptTerms: true, ...over } });

const login = (biz: Biz, phone: string, password: string) => app.inject({ method: 'POST', url: `${biz.base}/account/login`, payload: { phone, password } });

const bookWithSession = (biz: Biz, cookie: string, date: string, time: string, over: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `${biz.base}/appointments`, headers: { cookie }, payload: publicPayload(biz, date, time, over) });

describe('cuentas de cliente: registro e ingreso', () => {
  it('registrarse crea la cuenta, la vincula a un cliente del negocio y deja la sesión activa', async () => {
    const biz = await setupBiz(app, 'Cuentas');
    const res = await register(biz);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ name: 'Cliente Prueba', mustChangePassword: false });
    const cookie = sessionCookie(res);

    const me = await app.inject({ method: 'GET', url: `${biz.base}/account/me`, headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: body.id });
  });

  it('el mismo teléfono dos veces en el mismo negocio es 409 (account_exists)', async () => {
    const biz = await setupBiz(app, 'Duplicado');
    const phone = nextPhone();
    expect((await register(biz, { phone })).statusCode).toBe(201);
    const second = await register(biz, { phone, name: 'Otra persona' });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('account_exists');
  });

  it('contraseña incorrecta no entra; la correcta sí', async () => {
    const biz = await setupBiz(app, 'Login');
    const phone = nextPhone();
    await register(biz, { phone, password: 'Clavesegura1' });
    const wrong = await login(biz, phone, 'Incorrecta99');
    expect(wrong.statusCode).toBe(401);
    const right = await login(biz, phone, 'Clavesegura1');
    expect(right.statusCode).toBe(200);
  });

  it('sin sesión, "me" responde 204 (no es un error: la página sigue sirviendo a invitados)', async () => {
    const biz = await setupBiz(app, 'Invitado');
    expect((await app.inject({ method: 'GET', url: `${biz.base}/account/me` })).statusCode).toBe(204);
  });

  it('cerrar sesión revoca la cookie: "me" vuelve a 204 con la misma cookie', async () => {
    const biz = await setupBiz(app, 'Logout');
    const reg = await register(biz);
    const cookie = sessionCookie(reg);
    expect((await app.inject({ method: 'POST', url: `${biz.base}/account/logout`, headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `${biz.base}/account/me`, headers: { cookie } })).statusCode).toBe(204);
  });

  it('agendar como invitado sigue funcionando exactamente igual, con o sin que el negocio tenga cuentas de cliente', async () => {
    const biz = await setupBiz(app, 'InvitadoReserva');
    const res = await book(app, biz, workday(3), '10:00');
    expect(res.statusCode).toBe(201);
    expect(res.json().appointment.status).toBeDefined();
  });
});

describe('cuentas de cliente: aislamiento entre negocios (crítico)', () => {
  it('el mismo teléfono en dos negocios son cuentas independientes, con contraseñas distintas', async () => {
    const bizA = await setupBiz(app, 'NegocioA');
    const bizB = await setupBiz(app, 'NegocioB');
    const phone = nextPhone();
    expect((await register(bizA, { phone, password: 'ClaveDeA123' })).statusCode).toBe(201);
    expect((await register(bizB, { phone, password: 'ClaveDeB456' })).statusCode).toBe(201);

    // La clave de A no sirve en B, y viceversa.
    expect((await login(bizB, phone, 'ClaveDeA123')).statusCode).toBe(401);
    expect((await login(bizA, phone, 'ClaveDeB456')).statusCode).toBe(401);
    expect((await login(bizA, phone, 'ClaveDeA123')).statusCode).toBe(200);
    expect((await login(bizB, phone, 'ClaveDeB456')).statusCode).toBe(200);
  });

  it('reusar a mano la cookie de sesión de un negocio contra el otro (saltándose el Path del navegador) no filtra nada', async () => {
    const bizA = await setupBiz(app, 'AtaqueA');
    const bizB = await setupBiz(app, 'AtaqueB');
    const regA = await register(bizA);
    const cookieA = sessionCookie(regA);

    // Petición manual con la cookie de A directamente contra las rutas de B: nada de lo que un navegador
    // real haría (el Path de la cookie ya lo impediría) — esto es el resguardo del lado del servidor.
    const crossMe = await app.inject({ method: 'GET', url: `${bizB.base}/account/me`, headers: { cookie: cookieA } });
    expect(crossMe.statusCode).toBe(204); // ni error ni datos: simplemente no hay sesión válida para B

    const crossAppointments = await app.inject({ method: 'GET', url: `${bizB.base}/account/appointments`, headers: { cookie: cookieA } });
    expect(crossAppointments.statusCode).toBe(401);

    const crossDelete = await app.inject({ method: 'DELETE', url: `${bizB.base}/account`, headers: { cookie: cookieA }, payload: { password: 'cualquiera' } });
    expect(crossDelete.statusCode).toBe(401);
  });

  it('una reserva hecha con sesión en un negocio no es visible como "mis citas" en otro, aunque sea el mismo teléfono', async () => {
    const bizA = await setupBiz(app, 'CitasA');
    const bizB = await setupBiz(app, 'CitasB');
    const phone = nextPhone();
    const cookieA = sessionCookie(await register(bizA, { phone }));
    await register(bizB, { phone });

    expect((await bookWithSession(bizA, cookieA, workday(3), '10:00')).statusCode).toBe(201);

    const myAppointmentsA = await app.inject({ method: 'GET', url: `${bizA.base}/account/appointments`, headers: { cookie: cookieA } });
    expect(myAppointmentsA.json()).toHaveLength(1);

    const cookieB = sessionCookie(await login(bizB, phone, 'Clavesegura1'));
    const myAppointmentsB = await app.inject({ method: 'GET', url: `${bizB.base}/account/appointments`, headers: { cookie: cookieB } });
    expect(myAppointmentsB.json()).toHaveLength(0);
  });
});

describe('cuentas de cliente: reservar con sesión', () => {
  it('la cita queda asociada a la cuenta; otro teléfono de contacto en esa cita no crea un cliente aparte', async () => {
    const biz = await setupBiz(app, 'ReservaConCuenta');
    const phone = nextPhone();
    const regRes = await register(biz, { phone });
    const accountId = regRes.json().id;
    const cookie = sessionCookie(regRes);

    // En la cita se escribe OTRO teléfono de contacto; la cuenta (no ese teléfono) es la dueña de la cita.
    const otherContactPhone = nextPhone();
    const res = await bookWithSession(biz, cookie, workday(3), '10:00', { customer: { firstName: 'Invitada', lastName: 'X', email: 'x@correo.com', phone: otherContactPhone, notes: '', custom: {} } });
    expect(res.statusCode).toBe(201);

    const mine = await app.inject({ method: 'GET', url: `${biz.base}/account/appointments`, headers: { cookie } });
    expect(mine.json()).toHaveLength(1);

    const [account] = await testDb.db.select().from(clientAccounts).where(eq(clientAccounts.id, accountId));
    const [created] = await testDb.db.select().from(appointments).where(eq(appointments.clientAccountId, accountId));
    expect(created?.clientId).toBe(account?.clientId); // la cita quedó con el cliente de la cuenta, no uno nuevo por el teléfono escrito
  });

  it('dos citas de la misma cuenta suman la fidelización contra el mismo cliente, aunque cambien el teléfono de contacto', async () => {
    const biz = await setupBiz(app, 'FidelizacionCuenta');
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: { authorization: `Bearer ${biz.session.accessToken}` }, payload: { enabled: true, goal: 2, resetOnRedeem: true, rewardMessage: '', itemIds: [biz.serviceId] } });
    const phone = nextPhone();
    const regRes = await register(biz, { phone });
    const accountId = regRes.json().id;
    const cookie = sessionCookie(regRes);
    const [account] = await testDb.db.select().from(clientAccounts).where(eq(clientAccounts.id, accountId));

    for (const [i, time] of ['10:00', '11:30'].entries()) {
      const contact = nextPhone();
      const res = await bookWithSession(biz, cookie, workday(3 + i), time, { customer: { firstName: 'C', lastName: String(i), email: `c${i}@correo.com`, phone: contact, notes: '', custom: {} } });
      expect(res.statusCode).toBe(201);
      // El DTO público nunca expone el id (solo el token de gestión); se busca por su token de un solo uso.
      const token: string = res.json().token;
      const [created] = await testDb.db.select({ id: appointments.id }).from(appointments).where(eq(appointments.tokenHash, hashToken(token)));
      // Cerrar la cita es lo que acredita la fidelización (recordService, vía completion.ts).
      expect((await app.inject({ method: 'POST', url: `/api/appointments/${created!.id}/status`, headers: { authorization: `Bearer ${biz.session.accessToken}` }, payload: { status: 'completed' } })).statusCode).toBe(200);
    }

    const [progress] = await testDb.db.select().from(loyaltyProgress).where(eq(loyaltyProgress.clientId, account!.clientId));
    expect(progress?.count).toBe(2);

    const loyaltyView = await app.inject({ method: 'GET', url: `${biz.base}/account/loyalty`, headers: { cookie } });
    expect(loyaltyView.json()).toMatchObject({ active: true, count: 2, goal: 2, rewardAvailable: true });
  });
});

describe('cuentas de cliente: olvidé mi contraseña', () => {
  it('código de recuperación → token → nueva contraseña; cierra las sesiones abiertas', async () => {
    const biz = await setupBiz(app, 'Recuperar');
    const phone = nextPhone();
    const firstSession = sessionCookie(await register(biz, { phone, password: 'ClaveVieja1' }));

    const req = await app.inject({ method: 'POST', url: `${biz.base}/account/recover/request`, payload: { phone } });
    expect(req.statusCode).toBe(202);
    const code = req.json().devCode;
    expect(code).toMatch(/^\d{6}$/);

    const badCode = await app.inject({ method: 'POST', url: `${biz.base}/account/recover/verify`, payload: { phone, code: '000000' } });
    expect(badCode.statusCode).toBe(400);

    const verify = await app.inject({ method: 'POST', url: `${biz.base}/account/recover/verify`, payload: { phone, code } });
    expect(verify.statusCode).toBe(200);
    const resetToken = verify.json().resetToken;

    const reset = await app.inject({ method: 'POST', url: `${biz.base}/account/recover/reset`, payload: { resetToken, newPassword: 'ClaveNueva2' } });
    expect(reset.statusCode).toBe(200);

    // El token de restablecimiento sirve una sola vez.
    const reuse = await app.inject({ method: 'POST', url: `${biz.base}/account/recover/reset`, payload: { resetToken, newPassword: 'OtraVez3Aa' } });
    expect(reuse.statusCode).toBe(400);

    // La sesión que existía antes de restablecer quedó cerrada.
    expect((await app.inject({ method: 'GET', url: `${biz.base}/account/me`, headers: { cookie: firstSession } })).statusCode).toBe(204);

    expect((await login(biz, phone, 'ClaveVieja1')).statusCode).toBe(401);
    expect((await login(biz, phone, 'ClaveNueva2')).statusCode).toBe(200);
  });

  it('pedir un código no revela si el teléfono tiene cuenta (misma respuesta exista o no)', async () => {
    const biz = await setupBiz(app, 'SinEnumeracion');
    const withAccount = nextPhone();
    await register(biz, { phone: withAccount });
    const resWith = await app.inject({ method: 'POST', url: `${biz.base}/account/recover/request`, payload: { phone: withAccount } });
    const resWithout = await app.inject({ method: 'POST', url: `${biz.base}/account/recover/request`, payload: { phone: nextPhone() } });
    expect(resWith.statusCode).toBe(resWithout.statusCode);
    expect(Object.keys(resWith.json())).toContain('devCode');
    expect(Object.keys(resWithout.json())).not.toContain('devCode'); // sin cuenta no se genera ni se expone código
  });
});

describe('cuentas de cliente: el negocio restablece la contraseña (8.10)', () => {
  const ownerAuth = (biz: Biz) => ({ authorization: `Bearer ${biz.session.accessToken}` });

  it('solo el dueño puede restablecer; genera una temporal que obliga a cambiarla y cierra sesiones', async () => {
    const biz = await setupBiz(app, 'ResetDueno');
    const phone = nextPhone();
    const regRes = await register(biz, { phone, password: 'ClaveCliente1' });
    const oldCookie = sessionCookie(regRes);

    const clientsList = await app.inject({ method: 'GET', url: '/api/clients', headers: ownerAuth(biz) });
    const clientId = clientsList.json().find((c: { phone: string }) => c.phone === `57${phone}`)?.id ?? clientsList.json()[0]?.id;

    const detail = await app.inject({ method: 'GET', url: `/api/clients/${clientId}`, headers: ownerAuth(biz) });
    expect(detail.json().onlineAccount).toMatchObject({ lastLoginAt: null });

    const resetRes = await app.inject({ method: 'POST', url: `/api/clients/${clientId}/reset-password`, headers: ownerAuth(biz), payload: {} });
    expect(resetRes.statusCode).toBe(200);
    const tempPassword = resetRes.json().tempPassword;
    expect(tempPassword).toHaveLength(10);

    // La sesión que ya existía quedó cerrada.
    expect((await app.inject({ method: 'GET', url: `${biz.base}/account/me`, headers: { cookie: oldCookie } })).statusCode).toBe(204);

    expect((await login(biz, phone, 'ClaveCliente1')).statusCode).toBe(401);
    const afterReset = await login(biz, phone, tempPassword);
    expect(afterReset.statusCode).toBe(200);
    expect(afterReset.json().mustChangePassword).toBe(true);

    // Con la temporal adentro, cambia a una propia — el negocio nunca llega a conocerla.
    const changed = await app.inject({ method: 'POST', url: `${biz.base}/account/change-password`, headers: { cookie: sessionCookie(afterReset) }, payload: { currentPassword: tempPassword, newPassword: 'MiPropiaClave9' } });
    expect(changed.statusCode).toBe(200);
    const final = await login(biz, phone, 'MiPropiaClave9');
    expect(final.json().mustChangePassword).toBe(false);
  });

  it('sin cuenta en línea, restablecer responde 404 (no_online_account) en vez de inventar una', async () => {
    const biz = await setupBiz(app, 'SinCuentaReset');
    const created = await app.inject({ method: 'POST', url: '/api/clients', headers: ownerAuth(biz), payload: { name: 'Sin cuenta', phone: '', email: '', address: '', notes: '' } });
    const res = await app.inject({ method: 'POST', url: `/api/clients/${created.json().id}/reset-password`, headers: ownerAuth(biz), payload: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('no_online_account');
  });

  it('un empleado (no dueño) no puede restablecer contraseñas de clientes', async () => {
    const biz = await setupBiz(app, 'EmpleadoNoPuede');
    const phone = nextPhone();
    await register(biz, { phone });
    const clientsList = await app.inject({ method: 'GET', url: '/api/clients', headers: ownerAuth(biz) });
    const clientId = clientsList.json()[0]?.id;

    const empRes = await app.inject({ method: 'POST', url: '/api/employees', headers: ownerAuth(biz), payload: { name: 'Empleada', email: `emp-${Date.now()}@correo.com`, password: 'Empleada123', permissions: ['clients_view', 'clients_manage'] } });
    const empLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: empRes.json().email, password: 'Empleada123' } });
    const empToken = empLogin.json().accessToken;

    const res = await app.inject({ method: 'POST', url: `/api/clients/${clientId}/reset-password`, headers: { authorization: `Bearer ${empToken}` }, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe('cuentas de cliente: cancelar una cita propia desde "Mi cuenta" (sin enlace de gestión)', () => {
  it('cancela su propia cita; deja de ocupar la agenda y el estado queda en "cancelled"', async () => {
    const biz = await setupBiz(app, 'CancelarCuenta');
    const regRes = await register(biz);
    const cookie = sessionCookie(regRes);
    const booked = await bookWithSession(biz, cookie, workday(5), '10:00');
    expect(booked.statusCode).toBe(201);

    const mineBefore = await app.inject({ method: 'GET', url: `${biz.base}/account/appointments`, headers: { cookie } });
    const [appt] = mineBefore.json<Array<{ id: string; status: string; canCancel: boolean }>>();
    expect(appt).toMatchObject({ status: 'confirmed', canCancel: true });

    const cancelled = await app.inject({ method: 'POST', url: `${biz.base}/account/appointments/${appt!.id}/cancel`, headers: { cookie }, payload: { reason: 'Cambio de planes' } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ id: appt!.id, status: 'cancelled', canCancel: false });

    const mineAfter = await app.inject({ method: 'GET', url: `${biz.base}/account/appointments`, headers: { cookie } });
    expect(mineAfter.json<Array<{ status: string }>>()[0]).toMatchObject({ status: 'cancelled' });
  });

  it('no puede cancelar una cita de OTRA cuenta (ni de otro negocio): 404, no revienta ni revela que existe', async () => {
    const bizA = await setupBiz(app, 'CancelarAjenaA');
    const bizB = await setupBiz(app, 'CancelarAjenaB');
    const cookieA = sessionCookie(await register(bizA));
    const cookieB = sessionCookie(await register(bizB));
    const bookedA = await bookWithSession(bizA, cookieA, workday(5), '10:00');
    const [apptA] = (await app.inject({ method: 'GET', url: `${bizA.base}/account/appointments`, headers: { cookie: cookieA } })).json<Array<{ id: string }>>();
    void bookedA;

    // Otra cuenta del MISMO negocio.
    const otherInBizA = await app.inject({ method: 'POST', url: `${bizA.base}/account/appointments/${apptA!.id}/cancel`, headers: { cookie: sessionCookie(await register(bizA)) }, payload: {} });
    expect(otherInBizA.statusCode).toBe(404);

    // Una cuenta de OTRO negocio, probando el id directamente contra la ruta de B.
    const crossBusiness = await app.inject({ method: 'POST', url: `${bizB.base}/account/appointments/${apptA!.id}/cancel`, headers: { cookie: cookieB }, payload: {} });
    expect(crossBusiness.statusCode).toBe(404);

    // La cita de A sigue intacta.
    const stillThere = await app.inject({ method: 'GET', url: `${bizA.base}/account/appointments`, headers: { cookie: cookieA } });
    expect(stillThere.json<Array<{ status: string }>>()[0]).toMatchObject({ status: 'confirmed' });
  });

  it('sin sesión, cancelar se rechaza (401)', async () => {
    const biz = await setupBiz(app, 'CancelarSinSesion');
    const cookie = sessionCookie(await register(biz));
    const booked = await bookWithSession(biz, cookie, workday(5), '10:00');
    void booked;
    const [appt] = (await app.inject({ method: 'GET', url: `${biz.base}/account/appointments`, headers: { cookie } })).json<Array<{ id: string }>>();

    const res = await app.inject({ method: 'POST', url: `${biz.base}/account/appointments/${appt!.id}/cancel`, payload: {} });
    expect(res.statusCode).toBe(401);
  });
});
