import { addDaysToDate, localDateTimeIn, type AuthSession, type BirthdayStatusDto, type Client, type ClientBirthdayDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, mergeConfig } from '../src/app';
import { loadConfig } from '../src/config';
import { issueDueBirthdayRewards } from '../src/birthday';
import { auth, createEmployee, createService, nextPhone, publicPayload, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Programa de cumpleaños. Todo con datos de prueba en una base aislada; los avisos solo se guardan en el centro de
 * notificaciones de la base de prueba (ningún dispositivo registrado: no sale ningún push real).
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
let config: Parameters<typeof issueDueBirthdayRewards>[0]['config'];

beforeAll(async () => {
  testDb = await createTestDatabase();
  const setup = testAppConfig({ exposeDevOtp: true });
  cleanupConfig = setup.cleanup;
  app = await buildApp({ db: testDb.db, config: setup.config });
  config = mergeConfig(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), setup.config);
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const q = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => testDb.pool.query(text, values).then((r) => r.rows as T[]);
const issue = (now?: Date) => issueDueBirthdayRewards({ db: testDb.db, config }, now);
const send = (session: AuthSession, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, headers: auth(session), payload: payload as object | undefined });

const PROGRAM = { enabled: true, rewardKind: 'percent', rewardValue: 20, scope: 'all', validDays: 7, minTotal: 0, combinable: false, message: '¡Feliz cumpleaños!' };
const enable = async (biz: Biz, over: Record<string, unknown> = {}) => expect((await send(biz.session, 'PUT', '/api/birthday/program', { ...PROGRAM, ...over })).statusCode).toBe(200);
const newClient = async (biz: Biz, over: Record<string, unknown> = {}) => {
  const res = await send(biz.session, 'POST', '/api/clients', { name: `Cliente ${nextPhone()}`, phone: nextPhone(), ...over });
  expect(res.statusCode).toBe(201);
  return res.json<Client>();
};
const status = async (biz: Biz, clientId: string) => (await send(biz.session, 'GET', `/api/clients/${clientId}/birthday`)).json<BirthdayStatusDto>();
const rewardsOf = (clientId: string) => q<{ id: string; year: number; starts_on: string; ends_on: string; status: string }>(`select id, year, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, status from birthday_rewards where client_id = $1 order by year`, [clientId]);

/** Fecha de nacimiento cuyo cumpleaños fue AYER en Bogotá (año bisiesto: sirve aunque ayer fuera 29 de febrero). */
const bornYesterday = () => `1992-${addDaysToDate(localDateTimeIn('America/Bogota').date, -1).slice(5)}`;

describe('configuración del programa', () => {
  it('apagado por defecto; solo el dueño lo cambia; el servidor valida rangos, combinaciones y campos de más', async () => {
    const biz = await setupBiz(app, 'Cumple config');
    expect((await send(biz.session, 'GET', '/api/birthday/program')).json()).toMatchObject({ enabled: false, updatedAt: null });
    for (const bad of [{ rewardValue: 101 }, { rewardKind: 'fixed', rewardValue: 0 }, { validDays: 0 }, { validDays: 61 }, { minTotal: -1 }, { scope: 'todo' }, { extra: true }]) {
      expect((await send(biz.session, 'PUT', '/api/birthday/program', { ...PROGRAM, ...bad })).statusCode).toBe(400);
    }
    const employee = await createEmployee(app, biz.session, ['clients_manage', 'services_record']);
    expect((await send(employee.session, 'PUT', '/api/birthday/program', PROGRAM)).statusCode).toBe(403);
    expect((await send(employee.session, 'GET', '/api/birthday/program')).statusCode).toBe(403);
    await enable(biz);
    expect((await send(biz.session, 'GET', '/api/birthday/program')).json()).toMatchObject({ ...PROGRAM });
  });
});

describe('fecha de nacimiento opcional', () => {
  it('alta y edición manual: opcional, validada, no se borra por omisión y solo sale en el detalle', async () => {
    const biz = await setupBiz(app, 'Cumple fecha');
    const without = await newClient(biz);
    expect((await send(biz.session, 'GET', `/api/clients/${without.id}`)).json<Client>().birthDate).toBeNull();
    for (const bad of ['2023-02-29', '1990-13-01', '1899-12-31', '2999-01-01', '01/02/1990']) {
      expect((await send(biz.session, 'POST', '/api/clients', { name: 'Fecha mala', birthDate: bad })).statusCode).toBe(400);
    }
    const withDate = await newClient(biz, { birthDate: '2000-02-29' });
    expect(withDate.birthDate).toBe('2000-02-29');
    // Edición sin el campo (formulario viejo): la fecha se conserva. Con null: se quita a propósito.
    expect((await send(biz.session, 'PUT', `/api/clients/${withDate.id}`, { name: 'Renombrado' })).json<Client>().birthDate).toBe('2000-02-29');
    const list = await send(biz.session, 'GET', '/api/clients');
    expect(list.body).not.toContain('2000-02-29');
    expect((await send(biz.session, 'PUT', `/api/clients/${withDate.id}`, { name: 'Renombrado', birthDate: null })).json<Client>().birthDate).toBeNull();
  });

  it('cuenta pública: registro con o sin fecha, edición y borrado; nunca bloquea el registro', async () => {
    const biz = await setupBiz(app, 'Cumple cuenta');
    const plain = await app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Sin fecha', phone: nextPhone(), password: 'Clavesegura1', acceptTerms: true } });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().birthDate).toBeNull();
    expect((await app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Futuro', phone: nextPhone(), password: 'Clavesegura1', acceptTerms: true, birthDate: '2999-01-01' } })).statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Con fecha', phone: nextPhone(), password: 'Clavesegura1', acceptTerms: true, birthDate: '1995-07-20' } });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    expect(res.json().birthDate).toBe('1995-07-20');
    const put = (payload: object) => app.inject({ method: 'PUT', url: `${biz.base}/account/me`, headers: { cookie }, payload });
    expect((await put({ name: 'Con fecha 2' })).json().birthDate).toBe('1995-07-20');
    expect((await put({ birthDate: '1995-07-21' })).json().birthDate).toBe('1995-07-21');
    expect((await put({ birthDate: null })).json().birthDate).toBeNull();
    expect((await app.inject({ method: 'GET', url: `${biz.base}/account/birthday`, headers: { cookie } })).json<ClientBirthdayDto>()).toEqual({ active: false });
  });
});

describe('emisión: zona horaria, año nuevo, 29 de febrero y una por año', () => {
  it('programa apagado o cliente sin fecha: no hay recompensas ni avisos', async () => {
    const biz = await setupBiz(app, 'Cumple apagado');
    const c = await newClient(biz, { birthDate: '1990-05-10' });
    await issue(new Date('2027-05-10T15:00:00Z'));
    expect(await rewardsOf(c.id)).toEqual([]);
    await enable(biz);
    const noDate = await newClient(biz);
    await issue(new Date('2027-05-10T15:00:00Z'));
    expect(await rewardsOf(noDate.id)).toEqual([]);
    expect((await status(biz, noDate.id))).toMatchObject({ programEnabled: true, hasBirthDate: false, reward: null });
  });

  it('se emite el día del cumpleaños desde las 08:00 de la zona del NEGOCIO (no la del servidor)', async () => {
    const bogota = await setupBiz(app, 'Cumple Bogota');
    await enable(bogota);
    const c = await newClient(bogota, { birthDate: '1990-03-10' });
    await issue(new Date('2027-03-10T12:00:00Z')); // 07:00 en Bogotá: todavía no
    expect(await rewardsOf(c.id)).toEqual([]);
    await issue(new Date('2027-03-10T13:30:00Z')); // 08:30 en Bogotá
    expect(await rewardsOf(c.id)).toEqual([expect.objectContaining({ year: 2027, starts_on: '2027-03-10', ends_on: '2027-03-16', status: 'available' })]);

    const tokyo = await setupBiz(app, 'Cumple Tokio');
    await q(`update businesses set timezone = 'Asia/Tokyo' where id = $1`, [tokyo.session.business.id]);
    await enable(tokyo);
    const t = await newClient(tokyo, { birthDate: '1990-03-10' });
    await issue(new Date('2027-03-09T23:30:00Z')); // aún 9 de marzo en UTC, pero 10 de marzo 08:30 en Tokio
    expect(await rewardsOf(t.id)).toEqual([expect.objectContaining({ starts_on: '2027-03-10' })]);
  });

  it('29 de febrero: el 28 en años no bisiestos y el 29 en bisiestos; vigencia que cruza el año nuevo', async () => {
    const biz = await setupBiz(app, 'Cumple bisiesto');
    await enable(biz);
    const leap = await newClient(biz, { birthDate: '2000-02-29' });
    await issue(new Date('2027-02-28T14:00:00Z'));
    expect(await rewardsOf(leap.id)).toEqual([expect.objectContaining({ year: 2027, starts_on: '2027-02-28' })]);
    await issue(new Date('2028-02-29T14:00:00Z'));
    expect((await rewardsOf(leap.id)).map((r) => r.starts_on)).toEqual(['2027-02-28', '2028-02-29']);

    const nye = await newClient(biz, { birthDate: '1995-12-31' });
    await issue(new Date('2028-01-02T14:00:00Z')); // el trabajo no corrió el 31: se pone al día con la vigencia aún abierta
    expect(await rewardsOf(nye.id)).toEqual([expect.objectContaining({ year: 2027, starts_on: '2027-12-31', ends_on: '2028-01-06' })]);
  });

  it('una por cliente, negocio y año: reintentos, ejecuciones simultáneas y cambios de fecha no emiten otra; el año siguiente sí', async () => {
    const biz = await setupBiz(app, 'Cumple unica');
    await enable(biz);
    const c = await newClient(biz, { birthDate: '1988-06-15' });
    const at = new Date('2027-06-15T15:00:00Z');
    await Promise.all([issue(at), issue(at), issue(at)]);
    await issue(at);
    expect(await rewardsOf(c.id)).toHaveLength(1);
    // Cambiar la fecha a otro día dentro de la ventana no habilita una segunda ese año.
    await send(biz.session, 'PUT', `/api/clients/${c.id}`, { name: c.name, phone: c.phone, birthDate: '1988-06-17' });
    await issue(new Date('2027-06-17T15:00:00Z'));
    expect(await rewardsOf(c.id)).toHaveLength(1);
    // La base de datos lo impide aunque alguien intentara insertarla a mano.
    await expect(q(`insert into birthday_rewards (business_id, client_id, year, starts_on, ends_on, reward_kind, reward_value, scope, min_total, combinable) values ($1, $2, 2027, '2027-06-17', '2027-06-23', 'percent', 20, 'all', 0, false)`, [biz.session.business.id, c.id])).rejects.toThrow(/birthday_rewards_once_uq/);
    await issue(new Date('2028-06-17T15:00:00Z'));
    expect((await rewardsOf(c.id)).map((r) => r.year)).toEqual([2027, 2028]);

    // Aviso interno al negocio: uno por recompensa, con el nombre y la vigencia, nunca la fecha de nacimiento.
    const notes = await q<{ dedupe_key: string; params: Record<string, string>; category: string; business_id: string }>(`select dedupe_key, params, category, business_id from notifications where dedupe_key like 'birthday:%' and business_id = $1`, [biz.session.business.id]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ category: 'clients', params: { name: c.name, date: '21/06/2027' } });
    expect(JSON.stringify(notes)).not.toMatch(/1988|06-15|06-17/);
  });
});

describe('canje en caja', () => {
  async function ready(over: Record<string, unknown> = {}) {
    const biz = await setupBiz(app, 'Cumple caja');
    await enable(biz, { scope: 'services', ...over });
    const product = await createService(app, biz.session, { name: 'Champú', price: 10000, kind: 'product', stock: 20 });
    const client = await newClient(biz, { birthDate: bornYesterday() });
    await issue();
    const st = await status(biz, client.id);
    expect(st.reward?.state).toBe('available');
    return { biz, product, client, rewardId: st.reward!.id };
  }
  const sale = (biz: Biz, clientId: string, productId: string, extra: Record<string, unknown> = {}, pay = 34000) =>
    send(biz.session, 'POST', '/api/sales', { clientId, lines: [{ kind: 'service', itemId: biz.serviceId }, { kind: 'product', itemId: productId }], payments: [{ method: 'cash', amount: pay }], ...extra });

  it('calcula el descuento en el servidor (20 % solo de servicios), queda canjeada y no se puede usar dos veces; anular la libera', async () => {
    const { biz, product, client, rewardId } = await ready();
    const res = await sale(biz, client.id, product.id, { birthdayRewardId: rewardId });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ subtotal: 40000, discount: 6000, total: 34000 });
    expect((await status(biz, client.id)).reward).toMatchObject({ state: 'redeemed', amount: 6000 });
    const again = await sale(biz, client.id, product.id, { birthdayRewardId: rewardId });
    expect([again.statusCode, again.json().code]).toEqual([409, 'birthday_reward_unavailable']);
    expect((await send(biz.session, 'POST', `/api/sales/${res.json().id}/void`, { reason: 'Error de cobro' })).statusCode).toBe(200);
    expect((await status(biz, client.id)).reward?.state).toBe('available');
  });

  it('dos ventas simultáneas con la misma recompensa: solo una la canjea', async () => {
    const { biz, product, client, rewardId } = await ready();
    const results = await Promise.all([sale(biz, client.id, product.id, { birthdayRewardId: rewardId }), sale(biz, client.id, product.id, { birthdayRewardId: rewardId })]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(Number((await q<{ n: string }>(`select count(*) as n from birthday_rewards where id = $1 and status = 'redeemed'`, [rewardId]))[0]!.n)).toBe(1);
  });

  it('condiciones: no combinable con descuento manual, compra mínima, vencida o programa apagado', async () => {
    const { biz, product, client, rewardId } = await ready();
    const combined = await sale(biz, client.id, product.id, { birthdayRewardId: rewardId, discount: 1000 }, 33000);
    expect([combined.statusCode, combined.json().code]).toEqual([409, 'birthday_not_combinable']);

    const min = await ready({ minTotal: 50000 });
    const short = await sale(min.biz, min.client.id, min.product.id, { birthdayRewardId: min.rewardId });
    expect([short.statusCode, short.json().code]).toEqual([409, 'birthday_min_total']);

    // Vencida: no se canjea y tampoco habilita otra ese año.
    await q(`update birthday_rewards set starts_on = starts_on - 30, ends_on = ends_on - 30 where id = $1`, [rewardId]);
    expect((await status(biz, client.id)).reward?.state).toBe('expired');
    expect((await sale(biz, client.id, product.id, { birthdayRewardId: rewardId })).statusCode).toBe(409);
    await issue();
    expect((await rewardsOf(client.id)).length).toBe(1);

    const off = await ready();
    await enable(off.biz, { enabled: false });
    expect((await sale(off.biz, off.client.id, off.product.id, { birthdayRewardId: off.rewardId })).statusCode).toBe(409);
  });

  it('combinable con descuento manual: nunca deja el total por debajo de 0; si no queda nada por pagar no la gasta', async () => {
    const { biz, product, client, rewardId } = await ready({ scope: 'all', rewardKind: 'fixed', rewardValue: 38000, combinable: true });
    const nothing = await sale(biz, client.id, product.id, { birthdayRewardId: rewardId, discount: 40000, tip: 5000 }, 5000);
    expect([nothing.statusCode, nothing.json().code]).toEqual([409, 'birthday_nothing_left']);
    expect((await status(biz, client.id)).reward?.state).toBe('available');
    // Subtotal 40.000 − 5.000 manual = 35.000 por pagar: el regalo de 38.000 descuenta solo 35.000.
    const capped = await sale(biz, client.id, product.id, { birthdayRewardId: rewardId, discount: 5000, tip: 5000 }, 5000);
    expect(capped.statusCode).toBe(201);
    expect(capped.json()).toMatchObject({ subtotal: 40000, discount: 40000, total: 5000 });
    expect((await status(biz, client.id)).reward).toMatchObject({ state: 'redeemed', amount: 35000 });
  });

  it('aislamiento: otro negocio no ve ni canjea la recompensa de este', async () => {
    const a = await ready();
    const b = await setupBiz(app, 'Cumple ajeno');
    await enable(b);
    const bProduct = await createService(app, b.session, { name: 'Gel', price: 10000, kind: 'product', stock: 5 });
    const bClient = await newClient(b);
    expect((await send(b.session, 'GET', `/api/clients/${a.client.id}/birthday`)).statusCode).toBe(404);
    const steal = await sale(b, bClient.id, bProduct.id, { birthdayRewardId: a.rewardId });
    expect([steal.statusCode, steal.json().code]).toEqual([409, 'birthday_reward_unavailable']);
    expect((await status(a.biz, a.client.id)).reward?.state).toBe('available');
  });

  it('permisos: un empleado sin clientes ni caja no consulta el estado de cumpleaños', async () => {
    const { biz, client } = await ready();
    const nobody = await createEmployee(app, biz.session, []);
    expect((await send(nobody.session, 'GET', `/api/clients/${client.id}/birthday`)).statusCode).toBe(403);
    const cashier = await createEmployee(app, biz.session, ['services_record']);
    expect((await send(cashier.session, 'GET', `/api/clients/${client.id}/birthday`)).statusCode).toBe(200);
  });
});

describe('canje en la página web (pedido de productos con cuenta)', () => {
  it('solo productos: se aplica con la cuenta, queda reclamada y cancelar el pedido la libera', async () => {
    const biz = await setupBiz(app, 'Cumple pedido');
    await enable(biz, { scope: 'products', rewardKind: 'fixed', rewardValue: 5000 });
    expect((await send(biz.session, 'PUT', '/api/booking/settings', { productOrdersEnabled: true })).statusCode).toBe(200);
    const product = await createService(app, biz.session, { name: 'Shampoo', price: 15000, kind: 'product', stock: 5 });
    const phone = nextPhone();
    const reg = await app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Cliente Pedido', phone, password: 'Clavesegura1', acceptTerms: true, birthDate: bornYesterday() } });
    const cookie = String(reg.headers['set-cookie']).split(';')[0]!;
    await issue();
    const payload = { products: [{ itemId: product.id, quantity: 2 }], customer: { firstName: 'Cliente', lastName: 'Pedido', phone, email: '', notes: '', custom: {} }, acceptTerms: true, website: '', useBirthdayReward: true };
    const res = await app.inject({ method: 'POST', url: `${biz.base}/orders`, headers: { cookie }, payload });
    expect(res.statusCode).toBe(201);
    const [row] = await q<{ id: string; discount_amount: number; total_price: number }>(`select id, discount_amount, total_price from product_orders where business_id = $1`, [biz.session.business.id]);
    expect(row).toMatchObject({ total_price: 30000, discount_amount: 5000 });
    expect((await app.inject({ method: 'GET', url: `${biz.base}/account/birthday`, headers: { cookie } })).json()).toMatchObject({ reward: { state: 'claimed', amount: 5000 } });
    expect((await send(biz.session, 'POST', `/api/orders/${row!.id}/cancel`, { reason: 'Sin existencias' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `${biz.base}/account/birthday`, headers: { cookie } })).json()).toMatchObject({ reward: { state: 'available' } });
  });
});

describe('canje en la página web (reserva con cuenta)', () => {
  it('con sesión se aplica y queda reclamada; sin cuenta no; cancelar la cita la libera', async () => {
    const biz = await setupBiz(app, 'Cumple web');
    await enable(biz, { combinable: true });
    const phone = nextPhone();
    const reg = await app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Clienta Web', phone, password: 'Clavesegura1', acceptTerms: true, birthDate: bornYesterday() } });
    const cookie = String(reg.headers['set-cookie']).split(';')[0]!;
    await issue();
    const before = (await app.inject({ method: 'GET', url: `${biz.base}/account/birthday`, headers: { cookie } })).json<ClientBirthdayDto>();
    expect(before).toMatchObject({ active: true, hasBirthDate: true, reward: { state: 'available' } });

    const guest = await app.inject({ method: 'POST', url: `${biz.base}/appointments`, payload: publicPayload(biz, workday(3), '10:00', { useBirthdayReward: true }) });
    expect(guest.statusCode).toBe(401);

    const booked = await app.inject({ method: 'POST', url: `${biz.base}/appointments`, headers: { cookie }, payload: publicPayload(biz, workday(3), '11:00', { useBirthdayReward: true, customer: { firstName: 'Clienta', lastName: 'Web', phone, email: '', notes: '', custom: {} } }) });
    expect(booked.statusCode).toBe(201);
    const after = (await app.inject({ method: 'GET', url: `${biz.base}/account/birthday`, headers: { cookie } })).json<ClientBirthdayDto>();
    expect(after).toMatchObject({ reward: { state: 'claimed', amount: 6000 } });
    const [appt] = await q<{ id: string; discount_amount: number }>(`select id, discount_amount from appointments where business_id = $1`, [biz.session.business.id]);
    expect(appt!.discount_amount).toBe(6000);

    const second = await app.inject({ method: 'POST', url: `${biz.base}/appointments`, headers: { cookie }, payload: publicPayload(biz, workday(4), '11:00', { useBirthdayReward: true, customer: { firstName: 'Clienta', lastName: 'Web', phone, email: '', notes: '', custom: {} } }) });
    expect([second.statusCode, second.json().code]).toEqual([409, 'birthday_reward_unavailable']);

    expect((await app.inject({ method: 'POST', url: `${biz.base}/account/appointments/${appt!.id}/cancel`, headers: { cookie }, payload: { reason: '' } })).statusCode).toBe(200);
    const released = (await app.inject({ method: 'GET', url: `${biz.base}/account/birthday`, headers: { cookie } })).json<ClientBirthdayDto>();
    expect(released).toMatchObject({ reward: { state: 'available', amount: null } });
  });
});
