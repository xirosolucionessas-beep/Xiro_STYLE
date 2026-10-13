import type { PublicBookingResult, PublicWaitlistDto, WaitlistEntryDto } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, mergeConfig } from '../src/app';
import { processWaitlist } from '../src/booking/waitlist';
import { loadConfig } from '../src/config';
import type { Ctx } from '../src/context';
import { items, waitlistEntries } from '../src/db/schema';
import type { Notifier, WaitlistAvailableMessage } from '../src/notifier';
import { PublicCache } from '../src/publicCache';
import { MemoryRateStore, RateLimits } from '../src/rateStore';
import { LocalMediaStore } from '../src/storage';
import { auth, book, createEmployee, nextPhone, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Fase 4 del plan: lista de espera — por negocio, apagada por defecto, avisa una sola vez cuando se libera un horario. */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
let ctx: Ctx;
const sent: WaitlistAvailableMessage[] = [];

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  const notifier: Notifier = {
    sendOtp: async () => undefined,
    sendAppointmentReminder: async () => undefined,
    sendWaitlistAvailable: async (message) => void sent.push(message),
  };
  app = await buildApp({ db: testDb.db, config, notifier });
  const rates = new RateLimits(new MemoryRateStore());
  ctx = { db: testDb.db, config: mergeConfig(loadConfig(), config), notifier, accountLimiter: rates.limiter('account', 60_000), bookingLimiter: rates.limiter('booking-business', 60_000), rates, redis: null, publicCache: new PublicCache(null, 0), media: new LocalMediaStore(config.mediaDir ?? 'data/media'), boss: null, realtime: null, maps: null };
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const customer = (phone = nextPhone()) => ({ firstName: 'Luz', lastName: 'Gómez', email: '', phone, notes: '', custom: {} });
const join = (biz: Biz, date: string, over: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `${biz.base}/waitlist`, payload: { date, services: [biz.serviceId], customer: customer(), acceptTerms: true, website: '', ...over } });
const enable = (biz: Biz, on = true) => app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload: { waitlistEnabled: on } });
const entriesOf = (biz: Biz) => testDb.db.select().from(waitlistEntries).where(eq(waitlistEntries.businessId, biz.session.business.id));
/** El aviso corre después de responder (mejor esfuerzo): se espera a que aparezca. */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 50; i += 1) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 40));
  }
  return read();
}

describe('lista de espera: anotarse', () => {
  it('apagada por defecto: 403 y no se guarda nada; el perfil público lo dice', async () => {
    const biz = await setupBiz(app, 'Sin espera');
    const res = await join(biz, workday(3));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'waitlist_disabled' });
    expect(await entriesOf(biz)).toHaveLength(0);
    const profile = (await app.inject({ method: 'GET', url: biz.base })).json<{ features: { waitlist: boolean } }>();
    expect(profile.features.waitlist).toBe(false);
  });

  it('activa: devuelve el enlace personal una vez (solo se guarda su hash); con él se ve y se quita el lugar', async () => {
    const biz = await setupBiz(app, 'Con espera');
    await enable(biz);
    expect((await app.inject({ method: 'GET', url: biz.base })).json<{ features: { waitlist: boolean } }>().features.waitlist).toBe(true);
    const res = await join(biz, workday(3));
    expect(res.statusCode).toBe(201);
    const { token, entry, manageUrl } = res.json<{ token: string; entry: PublicWaitlistDto; manageUrl: string }>();
    expect(entry).toMatchObject({ date: workday(3), status: 'waiting', services: ['Corte'] });
    expect(manageUrl).toBe(`/reservar/${biz.slug}/espera/${token}`);
    const [row] = await entriesOf(biz);
    expect(row!.tokenHash).not.toBe(token);
    expect((await app.inject({ method: 'GET', url: `${biz.base}/waitlist/${token}` })).json<PublicWaitlistDto>().status).toBe('waiting');
    expect((await app.inject({ method: 'POST', url: `${biz.base}/waitlist/${token}/cancel` })).json<PublicWaitlistDto>().status).toBe('cancelled');
    // Otro negocio con el mismo enlace: 404, como si no existiera.
    const other = await setupBiz(app, 'Ajeno espera');
    expect((await app.inject({ method: 'GET', url: `${other.base}/waitlist/${token}` })).statusCode).toBe(404);
  });

  it('el mismo celular el mismo día no se duplica; máximo 3 días esperando por persona; fecha pasada o fuera del horizonte → 400', async () => {
    const biz = await setupBiz(app, 'Límites espera');
    await enable(biz);
    const phone = nextPhone();
    expect((await join(biz, workday(2), { customer: customer(phone) })).statusCode).toBe(201);
    expect((await join(biz, workday(2), { customer: customer(phone) })).statusCode).toBe(201);
    expect(await entriesOf(biz)).toHaveLength(1);
    expect((await join(biz, workday(3), { customer: customer(phone) })).statusCode).toBe(201);
    expect((await join(biz, workday(4), { customer: customer(phone) })).statusCode).toBe(201);
    expect((await join(biz, workday(5), { customer: customer(phone) })).json()).toMatchObject({ code: 'too_many_pending' });
    expect((await join(biz, '2020-01-01')).statusCode).toBe(400);
    expect((await join(biz, workday(200))).statusCode).toBe(400);
    expect((await join(biz, workday(2), { website: 'http://spam' })).statusCode).toBe(400);
    expect((await join(biz, workday(2), { services: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('lista de espera: avisos al liberarse un horario', () => {
  it('cancelar una cita ese día avisa a quien espera (una sola vez) por su canal', async () => {
    const biz = await setupBiz(app, 'Aviso espera');
    await enable(biz);
    const date = workday(4);
    const booked = (await book(app, biz, date, '10:00')).json<PublicBookingResult>();
    const phone = nextPhone();
    expect((await join(biz, date, { customer: customer(phone) })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `${biz.base}/appointments/${booked.token}/cancel`, payload: {} })).statusCode).toBe(200);
    const [row] = await until(() => entriesOf(biz), (rows) => rows[0]?.status === 'notified');
    expect(row!.status).toBe('notified');
    expect(row!.notifiedAt).not.toBeNull();
    // El celular queda normalizado con indicativo (57…).
    expect(await until(async () => sent.find((m) => m.to.endsWith(phone)), Boolean)).toMatchObject({ channel: 'whatsapp', date, bookingPath: `/reservar/${biz.slug}` });
    // Otra liberación ese día: ya avisada, no se repite.
    expect(await processWaitlist(ctx, biz.session.business.id, date)).toEqual([]);
  });

  it('negocio que la apagó, o servicio que ya no se ofrece en línea: no se avisa a nadie', async () => {
    const biz = await setupBiz(app, 'Sin aviso');
    await enable(biz);
    const date = workday(4);
    await join(biz, date);
    await enable(biz, false);
    expect(await processWaitlist(ctx, biz.session.business.id, date)).toEqual([]);
    await enable(biz, true);
    await testDb.db.update(items).set({ bookable: false }).where(eq(items.id, biz.serviceId));
    expect(await processWaitlist(ctx, biz.session.business.id, date)).toEqual([]);
    expect((await entriesOf(biz))[0]!.status).toBe('waiting');
  });

  it('procesar la lista de un negocio nunca toca la de otro', async () => {
    const a = await setupBiz(app, 'Espera A');
    const b = await setupBiz(app, 'Espera B');
    await enable(a);
    await enable(b);
    const date = workday(5);
    await join(a, date);
    await join(b, date);
    expect(await processWaitlist(ctx, a.session.business.id, date)).toHaveLength(1);
    expect((await entriesOf(b))[0]!.status).toBe('waiting');
  });
});

describe('lista de espera: panel', () => {
  it('el dueño la ve y quita a alguien; un empleado sin "agenda completa" no (403); otro negocio no la ve', async () => {
    const biz = await setupBiz(app, 'Panel espera');
    await enable(biz);
    await join(biz, workday(3));
    const list = await app.inject({ method: 'GET', url: '/api/waitlist', headers: auth(biz.session) });
    expect(list.statusCode).toBe(200);
    const [entry] = list.json<WaitlistEntryDto[]>();
    expect(entry).toMatchObject({ status: 'waiting', customerName: 'Luz Gómez', services: [{ id: biz.serviceId, name: 'Corte' }] });
    const { session: employee } = await createEmployee(app, biz.session, []);
    expect((await app.inject({ method: 'GET', url: '/api/waitlist', headers: auth(employee) })).statusCode).toBe(403);
    const intruder = await setupBiz(app, 'Intruso espera');
    expect((await app.inject({ method: 'GET', url: '/api/waitlist', headers: auth(intruder.session) })).json()).toEqual([]);
    expect((await app.inject({ method: 'POST', url: `/api/waitlist/${entry!.id}/cancel`, headers: auth(intruder.session) })).statusCode).toBe(404);
    const cancelled = await app.inject({ method: 'POST', url: `/api/waitlist/${entry!.id}/cancel`, headers: auth(biz.session) });
    expect(cancelled.json<WaitlistEntryDto>().status).toBe('cancelled');
    expect((await app.inject({ method: 'POST', url: `/api/waitlist/${entry!.id}/cancel`, headers: auth(biz.session) })).statusCode).toBe(409);
  });
});
