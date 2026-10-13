import type { PublicAppointmentDto, PublicBookingResult } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Notifier, ReviewRequestMessage } from '../src/notifier';
import { auth, book, nextPhone, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Fase 4 del plan: pedir reseña al completar la cita, con un enlace firmado que SOLO sirve para reseñar. */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
const sent: ReviewRequestMessage[] = [];

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  const notifier: Notifier = {
    sendOtp: async () => undefined,
    sendAppointmentReminder: async () => undefined,
    sendReviewRequest: async (message) => void sent.push(message),
  };
  app = await buildApp({ db: testDb.db, config, notifier });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

async function until<T>(read: () => T, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 50 && !ok(read()); i += 1) await new Promise((r) => setTimeout(r, 40));
  return read();
}

/** Reserva con avisos aceptados y la completa desde el panel; devuelve el mensaje de reseña enviado (si hubo). */
async function completeOne(biz: Biz, time: string, remindersOptIn = true) {
  const phone = nextPhone();
  const booked = (await book(app, biz, workday(2), time, { remindersOptIn, customer: { firstName: 'Sol', lastName: 'Ríos', email: '', phone, notes: '', custom: {} } })).json<PublicBookingResult>();
  const list = await app.inject({ method: 'GET', url: `/api/appointments?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 40 * 86_400_000).toISOString()}`, headers: auth(biz.session) });
  const id = list.json<Array<{ id: string; startsAt: string }>>().find((a) => a.startsAt === booked.appointment.startsAt)!.id;
  expect((await app.inject({ method: 'POST', url: `/api/appointments/${id}/status`, headers: auth(biz.session), payload: { status: 'completed' } })).statusCode).toBe(200);
  return until(() => sent.find((m) => m.to.endsWith(phone)), Boolean);
}

describe('pedir reseña al completar', () => {
  it('apagado por defecto: no se envía nada', async () => {
    const biz = await setupBiz(app, 'Sin pedir reseña');
    expect(await completeOne(biz, '09:00')).toBeUndefined();
  });

  it('activo: envía el enlace; con él se ve la cita y se reseña UNA vez; no sirve en otro negocio ni alterado', async () => {
    const biz = await setupBiz(app, 'Pide reseña');
    await app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload: { reviewRequestsEnabled: true } });
    const message = await completeOne(biz, '10:00');
    expect(message).toMatchObject({ channel: 'whatsapp', businessName: expect.any(String) });
    const prefix = `/reservar/${biz.slug}/resena/`;
    expect(message!.reviewPath.startsWith(prefix)).toBe(true);
    const token = message!.reviewPath.slice(prefix.length);

    const seen = await app.inject({ method: 'GET', url: `${biz.base}/review-link/${token}` });
    expect(seen.statusCode).toBe(200);
    expect(seen.json<PublicAppointmentDto>()).toMatchObject({ status: 'completed', canReview: true });
    const posted = await app.inject({ method: 'POST', url: `${biz.base}/review-link/${token}`, payload: { rating: 5, comment: '¡Excelente!' } });
    expect(posted.statusCode).toBe(200);
    expect(posted.json<PublicAppointmentDto>().canReview).toBe(false);
    expect((await app.inject({ method: 'POST', url: `${biz.base}/review-link/${token}`, payload: { rating: 1, comment: 'otra' } })).statusCode).toBe(409);

    const other = await setupBiz(app, 'Otro reseña');
    expect((await app.inject({ method: 'GET', url: `${other.base}/review-link/${token}` })).statusCode).toBe(404);
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await app.inject({ method: 'GET', url: `${biz.base}/review-link/${tampered}` })).statusCode).toBe(404);
    // El enlace de reseña NO es un enlace de gestión.
    expect((await app.inject({ method: 'POST', url: `${biz.base}/appointments/${token}/cancel`, payload: {} })).statusCode).toBe(404);
  });

  it('sin aceptar avisos al reservar: no se le escribe', async () => {
    const biz = await setupBiz(app, 'Sin avisos reseña');
    await app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload: { reviewRequestsEnabled: true } });
    expect(await completeOne(biz, '11:00', false)).toBeUndefined();
  });
});
