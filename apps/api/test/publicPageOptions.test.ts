import type { ClientAppointmentDto, PublicBookingProfile, PublicBookingResult } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { appointments, reviews } from '../src/db/schema';
import { auth, book, nextPhone, publicPayload, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Rediseño de la página pública: opciones por negocio (distintivo "sin pago anticipado", campo de comentarios), el tipo de
 * negocio en el perfil y calificar desde la cuenta del cliente. Nada de esto cambia lo que ya existía por defecto.
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const profileOf = async (biz: Biz) => (await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>();
const settings = (biz: Biz, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload });
function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value).split(';')[0]!;
}

describe('opciones de la página pública', () => {
  it('por defecto: sin distintivo y con comentarios (como siempre); el perfil trae el tipo de negocio', async () => {
    const biz = await setupBiz(app, 'Opciones');
    const profile = await profileOf(biz);
    expect(profile.features).toMatchObject({ noPrepayBadge: false, customerNotes: true });
    expect(profile.businessType).toBe('barbershop');
  });

  it('cada negocio activa o apaga lo suyo, sin afectar a otro', async () => {
    const a = await setupBiz(app, 'Opciones A');
    const b = await setupBiz(app, 'Opciones B');
    expect((await settings(a, { noPrepayBadgeEnabled: true, customerNotesEnabled: false })).statusCode).toBe(200);
    expect((await profileOf(a)).features).toMatchObject({ noPrepayBadge: true, customerNotes: false });
    expect((await profileOf(b)).features).toMatchObject({ noPrepayBadge: false, customerNotes: true });
  });

  it('comentarios apagados: la nota libre no se guarda (los campos propios del negocio sí); encendidos: se guarda como siempre', async () => {
    const off = await setupBiz(app, 'Sin notas');
    await settings(off, { customerNotesEnabled: false });
    const res = await book(app, off, workday(3), '10:00', { customer: { firstName: 'Ana', lastName: 'Ruiz', email: '', phone: nextPhone(), notes: 'Traigo a mi hijo', custom: {} } });
    expect(res.statusCode).toBe(201);
    const [row] = await testDb.db.select({ notes: appointments.customerNotes }).from(appointments).where(eq(appointments.businessId, off.session.business.id));
    expect(row!.notes).toBe('');

    const on = await setupBiz(app, 'Con notas');
    await book(app, on, workday(3), '10:00', { customer: { firstName: 'Ana', lastName: 'Ruiz', email: '', phone: nextPhone(), notes: 'Traigo a mi hijo', custom: {} } });
    const [kept] = await testDb.db.select({ notes: appointments.customerNotes }).from(appointments).where(eq(appointments.businessId, on.session.business.id));
    expect(kept!.notes).toBe('Traigo a mi hijo');
  });
});

describe('calificar desde la cuenta del cliente', () => {
  async function completedForAccount(label: string) {
    const biz = await setupBiz(app, label);
    const reg = await app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Sofía Mora', phone: nextPhone(), password: 'Clavesegura1', acceptTerms: true } });
    const cookie = sessionCookie(reg);
    const booked = await app.inject({ method: 'POST', url: `${biz.base}/appointments`, headers: { cookie }, payload: publicPayload(biz, workday(2), '10:00') });
    expect(booked.statusCode).toBe(201);
    const [appt] = await testDb.db.select({ id: appointments.id }).from(appointments).where(eq(appointments.businessId, biz.session.business.id));
    return { biz, cookie, id: appt!.id, booked: booked.json<PublicBookingResult>() };
  }

  it('solo una cita propia y COMPLETADA, una sola vez; queda por revisar (no cuenta en el promedio hasta aprobarla)', async () => {
    const { biz, cookie, id } = await completedForAccount('Califica');
    const review = (rating: number) => app.inject({ method: 'POST', url: `${biz.base}/account/appointments/${id}/review`, headers: { cookie }, payload: { rating, comment: '¡Excelente <b>servicio</b>!' } });
    expect((await review(5)).statusCode).toBe(409); // aún no completada
    await app.inject({ method: 'POST', url: `/api/appointments/${id}/status`, headers: auth(biz.session), payload: { status: 'completed' } });
    const res = await review(5);
    expect(res.statusCode).toBe(200);
    expect(res.json<ClientAppointmentDto>().canReview).toBe(false);
    expect((await review(4)).statusCode).toBe(409); // duplicada
    const [stored] = await testDb.db.select().from(reviews).where(eq(reviews.appointmentId, id));
    expect(stored).toMatchObject({ rating: 5, status: 'pending', businessId: biz.session.business.id });
    expect((await profileOf(biz)).rating.count).toBe(0); // sin aprobar no cuenta
  });

  it('sin sesión, cita ajena u otro negocio: no se puede (401/404)', async () => {
    const { biz, id } = await completedForAccount('Ajena');
    await app.inject({ method: 'POST', url: `/api/appointments/${id}/status`, headers: auth(biz.session), payload: { status: 'completed' } });
    expect((await app.inject({ method: 'POST', url: `${biz.base}/account/appointments/${id}/review`, payload: { rating: 5, comment: '' } })).statusCode).toBe(401);
    const other = await setupBiz(app, 'Otro negocio');
    const regOther = await app.inject({ method: 'POST', url: `${other.base}/account/register`, payload: { name: 'Intruso', phone: nextPhone(), password: 'Clavesegura1', acceptTerms: true } });
    expect((await app.inject({ method: 'POST', url: `${other.base}/account/appointments/${id}/review`, headers: { cookie: sessionCookie(regOther) }, payload: { rating: 1, comment: '' } })).statusCode).toBe(404);
    const regSame = await app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Otra clienta', phone: nextPhone(), password: 'Clavesegura1', acceptTerms: true } });
    expect((await app.inject({ method: 'POST', url: `${biz.base}/account/appointments/${id}/review`, headers: { cookie: sessionCookie(regSame) }, payload: { rating: 1, comment: '' } })).statusCode).toBe(404);
  });
});
