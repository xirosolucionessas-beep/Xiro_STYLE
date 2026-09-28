import type { PublicAppointmentDto, PublicBookingResult } from '@xiro/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { hashToken } from '../src/booking/appointments';
import { verifyCaptcha } from '../src/booking/captcha';
import { withBusiness } from '../src/booking/scope';
import { appointments, clients } from '../src/db/schema';
import { at, auth, availability, book, createService, nextPhone, publicPayload, setupBiz, stateAt, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

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

const staffPatch = (biz: Biz, url: string, payload: unknown, method: 'PUT' | 'PATCH' | 'POST' = 'PUT') => app.inject({ method, url, headers: auth(biz.session), payload: payload as object });

describe('página pública: contenido y lista blanca', () => {
  it('una página sin publicar, o una dirección que no existe, responde 404 igual', async () => {
    const unpublished = await setupBiz(app, 'Oculto');
    await staffPatch(unpublished, '/api/booking/profile', { published: false });
    expect((await app.inject({ method: 'GET', url: unpublished.base })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/public/booking/no-existe-este-negocio' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${unpublished.base}/availability?date=${workday(3)}&services=${unpublished.serviceId}` })).statusCode).toBe(404);
  });

  it('el perfil, el catálogo y el equipo solo muestran lo permitido (nada de correos, celulares, costos ni existencias)', async () => {
    const biz = await setupBiz(app, 'Vitrina');
    await createService(app, biz.session, { name: 'Producto raro', price: 9000, kind: 'product', stock: 7, internalUnitCost: 1234, internalNotes: 'NOTA-SECRETA' });
    const [profile, catalog, team] = await Promise.all([
      app.inject({ method: 'GET', url: biz.base }),
      app.inject({ method: 'GET', url: `${biz.base}/catalog` }),
      app.inject({ method: 'GET', url: `${biz.base}/team` }),
    ]);
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ slug: biz.slug, timezone: 'America/Bogota', currency: 'COP' });
    const everything = profile.body + catalog.body + team.body;
    for (const secret of ['NOTA-SECRETA', 'internalUnitCost', 'internalNotes', 'stock"', 'passwordHash', biz.session.user.email ?? 'no-email', 'owner']) expect(everything).not.toContain(secret);
    expect(team.json()).toEqual([expect.objectContaining({ id: biz.ownerId, name: 'La Dueña' })]);
    expect(Object.keys(team.json()[0])).toEqual(['id', 'name', 'bio', 'photoUrl', 'serviceIds']);
    const products = catalog.json<{ products: Array<Record<string, unknown>> }>().products;
    expect(products[0]).toMatchObject({ name: 'Producto raro', inStock: true });
    expect(products[0]).not.toHaveProperty('stock');
    expect(catalog.json<{ services: unknown[] }>().services).toHaveLength(1);
  });

  it('el dueño decide si aparece como profesional ("Yo también atiendo citas")', async () => {
    const biz = await setupBiz(app, 'Yo atiendo');
    expect((await app.inject({ method: 'GET', url: `${biz.base}/team` })).json()).toHaveLength(1);
    await staffPatch(biz, `/api/professionals/${biz.ownerId}`, { bookable: false }, 'PATCH');
    expect((await app.inject({ method: 'GET', url: `${biz.base}/team` })).json()).toHaveLength(0);
    // Sin nadie que atienda no hay horarios libres.
    const { body } = await availability(app, biz, workday(3));
    expect(body.slots.every((s) => s.state !== 'available')).toBe(true);
    await staffPatch(biz, `/api/professionals/${biz.ownerId}`, { bookable: true }, 'PATCH');
    expect(stateAt((await availability(app, biz, workday(3))).body.slots, '10:00')).toBe('available');
  });
});

describe('disponibilidad', () => {
  it('cada horario es libre / ocupado / no disponible y nunca dice quién lo ocupa', async () => {
    const biz = await setupBiz(app, 'Disp');
    const date = workday(4);
    const first = await availability(app, biz, date);
    expect(first.res.statusCode).toBe(200);
    expect(first.body).toMatchObject({ date, timezone: 'America/Bogota', intervalMinutes: 30, totalMinutes: 60 });
    expect(stateAt(first.body.slots, '09:00')).toBe('available');
    expect(stateAt(first.body.slots, '18:00')).toBe('available'); // 18:00–19:00 cabe justo
    expect(stateAt(first.body.slots, '18:30')).toBe('unavailable'); // ya no cabe una hora antes del cierre

    expect((await book(app, biz, date, '10:00')).statusCode).toBe(201);
    const after = await availability(app, biz, date);
    expect(stateAt(after.body.slots, '09:00')).toBe('available'); // termina justo cuando empieza la otra
    expect(stateAt(after.body.slots, '09:30')).toBe('unavailable'); // empieza libre pero choca con la de las 10:00
    expect(stateAt(after.body.slots, '10:00')).toBe('booked');
    expect(stateAt(after.body.slots, '10:30')).toBe('booked');
    expect(stateAt(after.body.slots, '11:00')).toBe('available');
    expect(Object.keys(after.body.slots[0]!).sort()).toEqual(['startsAt', 'state', 'time']);
    expect(JSON.stringify(after.body)).not.toMatch(/client|customer|professional|phone|email|ana@/i);
  });

  it('un día no laborable, un cierre del negocio y una ausencia no ofrecen horarios', async () => {
    const biz = await setupBiz(app, 'Cierres');
    const sunday = (() => { let d = workday(3); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); return d; })();
    expect((await availability(app, biz, sunday)).body.slots).toEqual([]);

    const holiday = workday(5);
    await staffPatch(biz, '/api/booking/closures', { date: holiday, reason: 'Festivo' }, 'POST');
    expect((await availability(app, biz, holiday)).body.slots.every((s) => s.state === 'unavailable')).toBe(true);
    const days = await app.inject({ method: 'GET', url: `${biz.base}/days?from=${holiday}&days=1&services=${biz.serviceId}` });
    expect(days.json()).toEqual([{ date: holiday, open: false, hasAvailability: false }]);

    const off = workday(6);
    await staffPatch(biz, `/api/professionals/${biz.ownerId}/time-off`, { startsAt: at(off, '09:00'), endsAt: at(off, '12:00'), reason: 'Cita médica' }, 'POST');
    const offSlots = (await availability(app, biz, off)).body.slots;
    expect(stateAt(offSlots, '10:00')).toBe('unavailable');
    expect(stateAt(offSlots, '12:00')).toBe('available');
  });

  it('respeta la anticipación mínima, el máximo de días y el pasado; el resumen de días coincide', async () => {
    const biz = await setupBiz(app, 'Reglas');
    await staffPatch(biz, '/api/booking/settings', { maxDaysAhead: 5, minNoticeMinutes: 60 });
    const far = workday(20);
    expect((await availability(app, biz, far)).body.slots.every((s) => s.state === 'unavailable')).toBe(true);
    const near = workday(3);
    expect(stateAt((await availability(app, biz, near)).body.slots, '10:00')).toBe('available');
    expect((await availability(app, biz, '2020-01-06')).body.slots.every((s) => s.state === 'unavailable')).toBe(true);
    const summary = await app.inject({ method: 'GET', url: `${biz.base}/days?from=${near}&days=3&services=${biz.serviceId}` });
    expect(summary.json<Array<{ open: boolean; hasAvailability: boolean }>>().every((d) => d.open === false || d.hasAvailability)).toBe(true);
  });

  it('rechaza fechas y selecciones inválidas sin llegar a la base de datos', async () => {
    const biz = await setupBiz(app, 'Inval');
    expect((await app.inject({ method: 'GET', url: `${biz.base}/availability?date=2026-02-31&services=${biz.serviceId}` })).json()).toMatchObject({ code: 'date_invalid' });
    expect((await app.inject({ method: 'GET', url: `${biz.base}/availability?date=abc&services=${biz.serviceId}` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `${biz.base}/availability?date=${workday(3)}` })).statusCode).toBe(400); // sin servicios
    expect((await app.inject({ method: 'GET', url: `${biz.base}/availability?date=${workday(3)}&services=no-es-uuid` })).statusCode).toBe(400);
  });
});

describe('reservar', () => {
  it('reserva, devuelve el enlace de gestión y solo guarda el hash del token', async () => {
    const biz = await setupBiz(app, 'Reserva');
    const date = workday(4);
    const res = await book(app, biz, date, '10:00');
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const { appointment, token } = res.json<PublicBookingResult>();
    expect(appointment).toMatchObject({ status: 'confirmed', startsAt: at(date, '10:00'), durationMinutes: 60, totalPrice: 30000, professionalName: 'La Dueña', canCancel: true, canReschedule: true, modificationsLeft: 2 });
    expect(appointment.items).toEqual([expect.objectContaining({ kind: 'service', name: 'Corte', price: 30000 })]);
    expect(token.length).toBeGreaterThan(30);

    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.businessId, biz.session.business.id));
    expect(row!.tokenHash).toBe(hashToken(token));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.termsAcceptedAt).not.toBeNull();

    const view = await app.inject({ method: 'GET', url: `${biz.base}/appointments/${token}` });
    expect(view.statusCode).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(view.json())).not.toMatch(/internalNotes|clientId|ana@correo|573/);
  });

  it('con confirmación manual queda pendiente', async () => {
    const biz = await setupBiz(app, 'Manual');
    await staffPatch(biz, '/api/booking/settings', { autoConfirm: false });
    const res = await book(app, biz, workday(4), '11:00');
    expect(res.json<PublicBookingResult>().appointment.status).toBe('pending');
  });

  it('valida el formulario: términos, campo trampa, correo obligatorio, celular real y horario de la cuadrícula', async () => {
    const biz = await setupBiz(app, 'Valida');
    const date = workday(4);
    const noTerms = await book(app, biz, date, '10:00', { acceptTerms: false });
    expect(noTerms.statusCode).toBe(400);
    expect((await book(app, biz, date, '10:00', { website: 'https://spam.example' })).statusCode).toBe(400);
    const customer = (over: object) => ({ firstName: 'Ana', lastName: 'Pérez', email: 'ana@correo.com', phone: nextPhone(), notes: '', custom: {}, ...over });
    expect((await book(app, biz, date, '10:00', { customer: customer({ email: undefined }) })).statusCode).toBe(400); // correo obligatorio por defecto
    expect((await book(app, biz, date, '10:00', { customer: customer({ phone: '123' }) })).statusCode).toBe(400);
    expect((await book(app, biz, date, '10:00', { customer: customer({ firstName: '   ' }) })).statusCode).toBe(400);
    expect((await book(app, biz, date, '10:10')).json()).toMatchObject({ code: 'slot_not_allowed' });
    await staffPatch(biz, '/api/booking/settings', { requireEmail: false });
    expect((await book(app, biz, date, '10:00', { customer: customer({ email: undefined }) })).statusCode).toBe(201);
    // Los campos personalizados obligatorios se exigen y se guardan en las notas.
    await staffPatch(biz, '/api/booking/settings', { requireEmail: false, customFields: [{ key: 'placa', label: 'Placa', type: 'text', required: true }] });
    expect((await book(app, biz, date, '12:00', { customer: customer({ custom: {} }) })).statusCode).toBe(400);
    expect((await book(app, biz, date, '12:00', { customer: customer({ custom: { placa: 'ABC123' } }) })).statusCode).toBe(201);
  });

  it('el mismo horario dos veces: la segunda recibe slot_taken con alternativas libres', async () => {
    const biz = await setupBiz(app, 'Choque');
    const date = workday(4);
    expect((await book(app, biz, date, '10:00')).statusCode).toBe(201);
    const second = await book(app, biz, date, '10:30'); // se cruza con 10:00–11:00
    expect(second.statusCode).toBe(409);
    const body = second.json<{ code: string; alternatives: Array<{ time: string; state: string; startsAt: string }> }>();
    expect(body.code).toBe('slot_taken');
    expect(body.alternatives.length).toBeGreaterThan(0);
    expect(body.alternatives.every((a) => a.state === 'available')).toBe(true);
    expect(body.alternatives.some((a) => a.time === '10:00' || a.time === '10:30')).toBe(false);
    // Una alternativa devuelta realmente se puede reservar.
    expect((await book(app, biz, date, body.alternatives[0]!.time)).statusCode).toBe(201);
  });

  it('concurrencia: 10 reservas simultáneas del mismo horario con un solo profesional → exactamente una gana', async () => {
    const biz = await setupBiz(app, 'Carrera');
    const date = workday(4);
    const results = await Promise.all(Array.from({ length: 10 }, () => book(app, biz, date, '10:00')));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().code === 'slot_taken' && Array.isArray(r.json().alternatives))).toBe(true);
    const rows = await testDb.db.select().from(appointments).where(eq(appointments.businessId, biz.session.business.id));
    expect(rows).toHaveLength(1);
  });

  it('concurrencia con dos profesionales y "primero disponible": exactamente dos ganan y a cada uno le toca una', async () => {
    const biz = await setupBiz(app, 'Carrera2');
    const emp = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(biz.session), payload: { name: 'Luis', email: `luis${nextPhone()}@correo.com`, password: 'Secreta123', permissions: [] } });
    const luisId = emp.json<{ id: string }>().id;
    await staffPatch(biz, `/api/professionals/${luisId}`, { bookable: true }, 'PATCH');
    const date = workday(4);
    const results = await Promise.all(Array.from({ length: 8 }, () => book(app, biz, date, '10:00')));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(6);
    const rows = await testDb.db.select({ pro: appointments.professionalId }).from(appointments).where(eq(appointments.businessId, biz.session.business.id));
    expect(new Set(rows.map((r) => r.pro)).size).toBe(2);
  });

  it('la base de datos misma rechaza dos citas activas que se cruzan (aunque el código fallara)', async () => {
    const biz = await setupBiz(app, 'Exclusion');
    const date = workday(4);
    const first = await book(app, biz, date, '10:00');
    expect(first.statusCode).toBe(201);
    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.businessId, biz.session.business.id));
    await expect(
      testDb.db.insert(appointments).values({ ...row!, id: undefined as never, tokenHash: null, startsAt: new Date(new Date(row!.startsAt).getTime() + 30 * 60_000), endsAt: new Date(new Date(row!.endsAt).getTime() + 30 * 60_000), busyUntil: new Date(new Date(row!.busyUntil).getTime() + 30 * 60_000) }),
    ).rejects.toMatchObject({ cause: { code: '23P01' } });
    // Una cita cancelada libera el horario.
    const token = first.json<PublicBookingResult>().token;
    expect((await app.inject({ method: 'POST', url: `${biz.base}/appointments/${token}/cancel`, payload: {} })).statusCode).toBe(200);
    expect((await book(app, biz, date, '10:00')).statusCode).toBe(201);
  });

  it('limita las reservas pendientes por celular y no revela si el celular ya era cliente', async () => {
    const biz = await setupBiz(app, 'Limite');
    await staffPatch(biz, '/api/booking/settings', { maxPendingPerPhone: 1 });
    const phone = nextPhone();
    const customer = { firstName: 'Ana', lastName: 'Pérez', email: 'ana@correo.com', phone, notes: '', custom: {} };
    const date = workday(4);
    const first = await book(app, biz, date, '09:00', { customer });
    expect(first.statusCode).toBe(201);
    const second = await book(app, biz, date, '11:00', { customer });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ code: 'too_many_pending' });

    // Un cliente que el negocio ya tenía: la reserva responde igual (mismas claves) y no cambia su nombre ni lo duplica.
    const existing = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(biz.session), payload: { name: 'Nombre Original', phone: `+57${nextPhone()}` } });
    const existingPhone = existing.json<{ phone: string }>().phone;
    const viaWeb = await book(app, biz, date, '13:00', { customer: { ...customer, phone: existingPhone, firstName: 'Otro', lastName: 'Nombre' } });
    expect(viaWeb.statusCode).toBe(201);
    expect(Object.keys(viaWeb.json())).toEqual(Object.keys(first.json()));
    const clientsList = (await app.inject({ method: 'GET', url: '/api/clients', headers: auth(biz.session) })).json<Array<{ name: string; phone: string | null }>>();
    expect(clientsList.filter((c) => c.phone === existingPhone)).toEqual([expect.objectContaining({ name: 'Nombre Original' })]);
  });

  it('cancelar y reprogramar con el enlace: ventana, tope de modificaciones y horario ocupado', async () => {
    const biz = await setupBiz(app, 'Gestion');
    await staffPatch(biz, '/api/booking/settings', { maxModifications: 1 });
    const date = workday(6);
    const made = (await book(app, biz, date, '10:00')).json<PublicBookingResult>();
    const url = `${biz.base}/appointments/${made.token}`;
    await book(app, biz, date, '15:00'); // otra persona ocupa las 15:00

    const taken = await app.inject({ method: 'POST', url: `${url}/reschedule`, payload: { startsAt: at(date, '15:00') } });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'slot_taken' });

    const moved = await app.inject({ method: 'POST', url: `${url}/reschedule`, payload: { startsAt: at(date, '16:00') } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json<PublicAppointmentDto>()).toMatchObject({ startsAt: at(date, '16:00'), modificationsLeft: 0, canReschedule: false, canCancel: true });
    expect(stateAt((await availability(app, biz, date)).body.slots, '10:00')).toBe('available'); // el horario viejo se liberó

    const again = await app.inject({ method: 'POST', url: `${url}/reschedule`, payload: { startsAt: at(date, '17:00') } });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'modifications_exceeded' });

    const cancelled = await app.inject({ method: 'POST', url: `${url}/cancel`, payload: { reason: 'Imprevisto' } });
    expect(cancelled.json<PublicAppointmentDto>().status).toBe('cancelled');
    expect((await app.inject({ method: 'POST', url: `${url}/cancel`, payload: {} })).json()).toMatchObject({ code: 'invalid_transition' });
    expect((await app.inject({ method: 'POST', url: `${url}/reschedule`, payload: { startsAt: at(date, '17:00') } })).json()).toMatchObject({ code: 'invalid_transition' });
  });

  it('fuera de la ventana de cancelación no se puede cancelar ni mover', async () => {
    const biz = await setupBiz(app, 'Ventana');
    await staffPatch(biz, '/api/booking/settings', { cancelUntilHours: 720 });
    const made = (await book(app, biz, workday(4), '10:00')).json<PublicBookingResult>();
    expect(made.appointment).toMatchObject({ canCancel: false, canReschedule: false });
    const cancel = await app.inject({ method: 'POST', url: `${biz.base}/appointments/${made.token}/cancel`, payload: {} });
    expect(cancel.json()).toMatchObject({ code: 'cancel_window_passed' });
    const move = await app.inject({ method: 'POST', url: `${biz.base}/appointments/${made.token}/reschedule`, payload: { startsAt: at(workday(4), '12:00') } });
    expect(move.json()).toMatchObject({ code: 'cancel_window_passed' });
  });

  it('el enlace de gestión caduca, y un token con formato inválido o desconocido responde 404', async () => {
    const biz = await setupBiz(app, 'Caduca');
    const made = (await book(app, biz, workday(4), '10:00')).json<PublicBookingResult>();
    expect((await app.inject({ method: 'GET', url: `${biz.base}/appointments/${made.token}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `${biz.base}/appointments/corto` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${biz.base}/appointments/${'A'.repeat(43)}` })).statusCode).toBe(404);
    await testDb.db.update(appointments).set({ tokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(appointments.tokenHash, hashToken(made.token)));
    expect((await app.inject({ method: 'GET', url: `${biz.base}/appointments/${made.token}` })).statusCode).toBe(404);
  });

  it('con Turnstile configurado exige token válido; sin secreto (pendiente de credenciales) no bloquea', async () => {
    const withSecret = await buildApp({ db: testDb.db, config: { ...testAppConfig().config, booking: { turnstileSecret: 'secreto' } } });
    try {
      const biz = await setupBiz(app, 'Captcha');
      const res = await withSecret.inject({ method: 'POST', url: `${biz.base}/appointments`, payload: publicPayload(biz, workday(4), '10:00') });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'captcha_failed' });
    } finally {
      await withSecret.close();
    }
    const ok = { ok: true, json: async () => ({ success: true }) };
    const bad = { ok: true, json: async () => ({ success: false }) };
    expect(await verifyCaptcha(null, undefined, '1.1.1.1')).toBe(true);
    expect(await verifyCaptcha('s', undefined, '1.1.1.1')).toBe(false);
    expect(await verifyCaptcha('s', 't', '1.1.1.1', async () => ok)).toBe(true);
    expect(await verifyCaptcha('s', 't', '1.1.1.1', async () => bad)).toBe(false);
    expect(await verifyCaptcha('s', 't', '1.1.1.1', async () => { throw new Error('sin red'); })).toBe(false);
  });

  it('límite por negocio: pasado el tope, la página de ese negocio responde 429 sin afectar a otros', async () => {
    const limited = await buildApp({ db: testDb.db, config: { ...testAppConfig({ rateLimit: { enabled: true, globalPerMinute: 10_000 } }).config, booking: { publicPerMinutePerBusiness: 3 } } });
    try {
      const a = await setupBiz(app, 'LimA');
      const b = await setupBiz(app, 'LimB');
      const codes: number[] = [];
      for (let i = 0; i < 5; i += 1) codes.push((await limited.inject({ method: 'GET', url: a.base })).statusCode);
      expect(codes).toEqual([200, 200, 200, 429, 429]);
      expect((await limited.inject({ method: 'GET', url: b.base })).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('aislamiento entre negocios (A no puede ver ni tocar a B)', () => {
  let a: Biz;
  let b: Biz;
  let bAppointment: { id: string; token: string };
  const date = workday(4);

  beforeAll(async () => {
    a = await setupBiz(app, 'Aislado A');
    b = await setupBiz(app, 'Aislado B');
    const made = (await book(app, b, date, '10:00')).json<PublicBookingResult>();
    const list = await app.inject({ method: 'GET', url: `/api/appointments?from=${at(date, '00:00')}&to=${at(date, '23:59')}`, headers: auth(b.session) });
    bAppointment = { id: list.json<Array<{ id: string }>>()[0]!.id, token: made.token };
  });

  it('las citas de B no aparecen en la agenda de A y sus ids responden 404 en todo endpoint', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/appointments?from=${at(date, '00:00')}&to=${at(date, '23:59')}`, headers: auth(a.session) });
    expect(list.json()).toEqual([]);
    for (const [method, url, payload] of [
      ['GET', `/api/appointments/${bAppointment.id}`, undefined],
      ['PATCH', `/api/appointments/${bAppointment.id}`, { internalNotes: 'hackeo' }],
      ['POST', `/api/appointments/${bAppointment.id}/status`, { status: 'cancelled' }],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(a.session), payload: payload as object | undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const stillThere = await app.inject({ method: 'GET', url: `/api/appointments/${bAppointment.id}`, headers: auth(b.session) });
    expect(stillThere.json()).toMatchObject({ status: 'confirmed', internalNotes: '' });
  });

  it('A no puede agendar con el servicio, el profesional, el cliente, el estilo ni el paquete de B', async () => {
    const bVariant = await app.inject({ method: 'POST', url: `/api/items/${b.serviceId}/variants`, headers: auth(b.session), payload: { name: 'Fade', price: 40000 } });
    expect(bVariant.statusCode).toBe(201);
    const bPackage = await app.inject({ method: 'POST', url: '/api/packages', headers: auth(b.session), payload: { name: 'Combo', price: 50000, entries: [{ itemId: b.serviceId }] } });
    expect(bPackage.statusCode).toBe(201);
    const bClient = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(b.session), payload: { name: 'Cliente de B' } });

    // Página pública de A con ids de B
    expect((await book(app, a, date, '12:00', { selection: { services: [{ itemId: b.serviceId }], packages: [], products: [] } })).json()).toMatchObject({ code: 'item_not_bookable' });
    expect((await book(app, a, date, '12:00', { selection: { services: [{ itemId: a.serviceId, variantId: bVariant.json().id }], packages: [], products: [] } })).json()).toMatchObject({ code: 'item_not_bookable' });
    expect((await book(app, a, date, '12:00', { selection: { services: [], packages: [bPackage.json().id], products: [] } })).json()).toMatchObject({ code: 'item_not_bookable' });
    expect((await book(app, a, date, '12:00', { professionalId: b.ownerId })).json()).toMatchObject({ code: 'professional_unavailable' });

    // Agenda del personal de A con ids de B
    const staff = (payload: object) => app.inject({ method: 'POST', url: '/api/appointments', headers: auth(a.session), payload });
    const base = { professionalId: a.ownerId, startsAt: at(date, '12:00'), selection: { services: [{ itemId: a.serviceId }], packages: [], products: [] } };
    expect((await staff({ ...base, clientId: bClient.json().id })).statusCode).toBe(404);
    expect((await staff({ ...base, newClient: { name: 'X' }, professionalId: b.ownerId })).statusCode).toBe(400);
    expect((await staff({ ...base, newClient: { name: 'X' }, selection: { services: [{ itemId: b.serviceId }], packages: [], products: [] } })).statusCode).toBe(400);

    // Administración de A sobre recursos de B
    expect((await app.inject({ method: 'PUT', url: `/api/variants/${bVariant.json().id}`, headers: auth(a.session), payload: { name: 'x', price: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/variants/${bVariant.json().id}`, headers: auth(a.session) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/items/${b.serviceId}/variants`, headers: auth(a.session) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/packages/${bPackage.json().id}`, headers: auth(a.session), payload: { name: 'x', price: 1, entries: [{ itemId: a.serviceId }] } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/packages', headers: auth(a.session), payload: { name: 'x', price: 1, entries: [{ itemId: b.serviceId }] } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/professionals/${b.ownerId}`, headers: auth(a.session), payload: { bookable: false } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/professionals/${b.ownerId}/services`, headers: auth(a.session), payload: { services: [] } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/professionals/${a.ownerId}/services`, headers: auth(a.session), payload: { services: [{ itemId: b.serviceId }] } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/professionals/${b.ownerId}/time-off`, headers: auth(a.session), payload: { startsAt: at(date, '09:00'), endsAt: at(date, '10:00') } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/professionals/${b.ownerId}/schedule`, headers: auth(a.session), payload: { blocks: [] } })).statusCode).toBe(404);
    // B sigue intacto
    expect((await app.inject({ method: 'GET', url: `/api/items/${b.serviceId}/variants`, headers: auth(b.session) })).json()).toHaveLength(1);
  });

  it('el token de B no abre ni cambia nada con la dirección de A, y viceversa', async () => {
    expect((await app.inject({ method: 'GET', url: `${a.base}/appointments/${bAppointment.token}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${a.base}/appointments/${bAppointment.token}/cancel`, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${a.base}/appointments/${bAppointment.token}/reschedule`, payload: { startsAt: at(date, '13:00') } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${b.base}/appointments/${bAppointment.token}` })).statusCode).toBe(200);
  });

  it('la disponibilidad de A no refleja las citas de B, ni siquiera a la misma hora', async () => {
    expect(stateAt((await availability(app, a, date)).body.slots, '10:00')).toBe('available');
    expect(stateAt((await availability(app, b, date)).body.slots, '10:00')).toBe('booked');
  });

  it('Row Level Security: con el rol de la aplicación solo se ven y se escriben filas del negocio activo', async () => {
    const both = await testDb.db.select({ id: appointments.id }).from(appointments).where(sql`${appointments.businessId} in (${a.session.business.id}, ${b.session.business.id})`);
    expect(both.length).toBeGreaterThan(0);

    // Sin negocio activo no se ve nada.
    const none = await testDb.db.transaction(async (tx) => {
      await tx.execute(sql`set local role xiro_app`);
      return tx.select({ id: appointments.id }).from(appointments);
    });
    expect(none).toEqual([]);

    // Con el negocio A activo, ni siquiera un SELECT sin filtro ve las de B.
    const asA = await withBusiness(testDb.db, a.session.business.id, (tx) => tx.select({ business: appointments.businessId }).from(appointments));
    expect(asA.every((row) => row.business === a.session.business.id)).toBe(true);
    const asB = await withBusiness(testDb.db, b.session.business.id, (tx) => tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.id, bAppointment.id)));
    expect(asB).toHaveLength(1);
    const crossRead = await withBusiness(testDb.db, a.session.business.id, (tx) => tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.id, bAppointment.id)));
    expect(crossRead).toEqual([]);

    // Escribir una fila de B estando en A es rechazado por la propia base de datos.
    const [source] = await testDb.db.select().from(appointments).where(eq(appointments.id, bAppointment.id));
    await expect(withBusiness(testDb.db, a.session.business.id, (tx) => tx.insert(appointments).values({ ...source!, id: undefined as never, tokenHash: null, startsAt: new Date(Date.now() + 9e9), endsAt: new Date(Date.now() + 9e9 + 1), busyUntil: new Date(Date.now() + 9e9 + 1) }))).rejects.toMatchObject({ cause: { code: '42501' } });
    // Ni actualizar ni borrar filas de B.
    const updated = await withBusiness(testDb.db, a.session.business.id, (tx) => tx.update(appointments).set({ internalNotes: 'x' }).where(eq(appointments.id, bAppointment.id)).returning({ id: appointments.id }));
    expect(updated).toEqual([]);
    const deleted = await withBusiness(testDb.db, a.session.business.id, (tx) => tx.delete(appointments).where(and(eq(appointments.id, bAppointment.id))).returning({ id: appointments.id }));
    expect(deleted).toEqual([]);
    // Y una fila con `business_id` de A no puede apuntar a un profesional de B (clave foránea compuesta).
    await expect(
      withBusiness(testDb.db, a.session.business.id, (tx) => tx.insert(appointments).values({ ...source!, id: undefined as never, businessId: a.session.business.id, tokenHash: null, startsAt: new Date(Date.now() + 9e9), endsAt: new Date(Date.now() + 9e9 + 1), busyUntil: new Date(Date.now() + 9e9 + 1) })),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('el rol de la aplicación no puede alterar tablas ajenas al módulo (mínimo privilegio)', async () => {
    await expect(testDb.db.transaction(async (tx) => { await tx.execute(sql`set local role xiro_app`); await tx.execute(sql`delete from users`); })).rejects.toBeTruthy();
    await expect(testDb.db.transaction(async (tx) => { await tx.execute(sql`set local role xiro_app`); await tx.execute(sql`update items set price = 1`); })).rejects.toBeTruthy();
  });
});

describe('estilos y paquetes en la reserva', () => {
  it('el precio y la duración salen del estilo o del paquete del negocio, nunca del cliente', async () => {
    const biz = await setupBiz(app, 'Estilos');
    const variant = (await app.inject({ method: 'POST', url: `/api/items/${biz.serviceId}/variants`, headers: auth(biz.session), payload: { name: 'Fade', price: 45000, durationMinutes: 90 } })).json<{ id: string }>();
    const second = await createService(app, biz.session, { name: 'Barba', price: 15000, durationMinutes: 30 });
    const pkg = (await app.inject({ method: 'POST', url: '/api/packages', headers: auth(biz.session), payload: { name: 'Corte + barba', price: 40000, entries: [{ itemId: biz.serviceId }, { itemId: second.id }] } })).json<{ id: string }>();

    const catalog = (await app.inject({ method: 'GET', url: `${biz.base}/catalog` })).json<{ services: Array<{ id: string; variants: Array<{ id: string; durationMinutes: number }> }>; packages: Array<{ id: string; durationMinutes: number; services: string[] }> }>();
    expect(catalog.services.find((s) => s.id === biz.serviceId)!.variants).toEqual([expect.objectContaining({ id: variant.id, durationMinutes: 90 })]);
    expect(catalog.packages).toEqual([expect.objectContaining({ id: pkg.id, durationMinutes: 90, services: ['Corte', 'Barba'] })]);

    const date = workday(4);
    const withVariant = await book(app, biz, date, '09:00', { selection: { services: [{ itemId: biz.serviceId, variantId: variant.id }], packages: [], products: [] }, totalPrice: 1, price: 1 });
    expect(withVariant.json<PublicBookingResult>().appointment).toMatchObject({ totalPrice: 45000, durationMinutes: 90 });
    const withPackage = await book(app, biz, date, '13:00', { selection: { services: [], packages: [pkg.id], products: [] } });
    expect(withPackage.json<PublicBookingResult>().appointment).toMatchObject({ totalPrice: 40000, durationMinutes: 90 });
    expect(withPackage.json<PublicBookingResult>().appointment.items).toEqual([expect.objectContaining({ kind: 'package', name: 'Corte + barba' })]);

    // Un servicio marcado como no reservable en línea no se puede reservar.
    await app.inject({ method: 'PUT', url: `/api/items/${second.id}`, headers: auth(biz.session), payload: { name: 'Barba', categoryId: second.categoryId, price: 15000, bookable: false, kind: 'service' } });
    expect((await book(app, biz, date, '16:00', { selection: { services: [{ itemId: second.id }], packages: [], products: [] } })).json()).toMatchObject({ code: 'item_not_bookable' });
  });
});

describe('derecho de supresión (Ley 1581): borrar los datos personales del cliente', () => {
  it('con el enlace de gestión, el cliente borra sus datos y la cita queda como registro contable', async () => {
    const biz = await setupBiz(app, 'Supresion');
    const made = (await book(app, biz, workday(4), '10:00')).json<PublicBookingResult>();
    const before = await testDb.db.select().from(clients).where(eq(clients.businessId, biz.session.business.id));
    expect(before[0]).toMatchObject({ name: 'Ana Pérez' });

    const res = await app.inject({ method: 'POST', url: `${biz.base}/appointments/${made.token}/privacy-delete`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const after = await testDb.db.select().from(clients).where(eq(clients.businessId, biz.session.business.id));
    expect(after[0]).toMatchObject({ name: 'Cliente eliminado', email: null, phone: null, address: '', notes: '' });
    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.businessId, biz.session.business.id));
    expect(row).toMatchObject({ customerNotes: '', termsAcceptedIp: null, status: 'confirmed', totalPrice: 30000 }); // la cita y el monto se conservan

    // El personal sigue viendo la cita (con el cliente ya anónimo) y puede completarla con normalidad.
    const list = await app.inject({ method: 'GET', url: `/api/appointments?from=${at(workday(4), '00:00')}&to=${at(workday(4), '23:59')}`, headers: auth(biz.session) });
    expect(list.json<Array<{ client: { name: string } }>>()[0]!.client.name).toBe('Cliente eliminado');

    // Un token desconocido, uno de otro negocio, o volver a pedirlo, no revela nada raro.
    expect((await app.inject({ method: 'POST', url: `${biz.base}/appointments/no-existe/privacy-delete`, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${biz.base}/appointments/${made.token}/privacy-delete`, payload: {} })).statusCode).toBe(200);
  });

  it('el token de un negocio no borra datos de otro', async () => {
    const a = await setupBiz(app, 'Supresion A');
    const b = await setupBiz(app, 'Supresion B');
    const made = (await book(app, b, workday(4), '10:00')).json<PublicBookingResult>();
    expect((await app.inject({ method: 'POST', url: `${a.base}/appointments/${made.token}/privacy-delete`, payload: {} })).statusCode).toBe(404);
    const [client] = await testDb.db.select().from(clients).where(eq(clients.businessId, b.session.business.id));
    expect(client!.name).toBe('Ana Pérez'); // intacto
  });
});

describe('reseñas: el cliente reseña su propia cita ya completada', () => {
  async function completed(biz: Biz) {
    const made = (await book(app, biz, workday(4), '10:00')).json<PublicBookingResult>();
    const list = await app.inject({ method: 'GET', url: `/api/appointments?from=${at(workday(4), '00:00')}&to=${at(workday(4), '23:59')}`, headers: auth(biz.session) });
    const id = list.json<Array<{ id: string }>>()[0]!.id;
    await app.inject({ method: 'POST', url: `/api/appointments/${id}/status`, headers: auth(biz.session), payload: { status: 'confirmed' } });
    await app.inject({ method: 'POST', url: `/api/appointments/${id}/status`, headers: auth(biz.session), payload: { status: 'completed' } });
    return made.token;
  }

  it('solo se puede reseñar una cita completada, una sola vez, y queda pendiente de moderar', async () => {
    const biz = await setupBiz(app, 'Reseñar');
    const made = (await book(app, biz, workday(5), '10:00')).json<PublicBookingResult>();

    const early = await app.inject({ method: 'POST', url: `${biz.base}/appointments/${made.token}/review`, payload: { rating: 5, comment: 'Excelente' } });
    expect(early.json()).toMatchObject({ code: 'invalid_transition' }); // todavía no está completada

    const token = await completed(biz);
    const view = await app.inject({ method: 'GET', url: `${biz.base}/appointments/${token}` });
    expect(view.json<PublicAppointmentDto>().canReview).toBe(true);

    const res = await app.inject({ method: 'POST', url: `${biz.base}/appointments/${token}/review`, payload: { rating: 5, comment: 'Muy buen corte' } });
    expect(res.statusCode).toBe(200);
    expect(res.json<PublicAppointmentDto>().canReview).toBe(false);

    const again = await app.inject({ method: 'POST', url: `${biz.base}/appointments/${token}/review`, payload: { rating: 1, comment: 'cambié de opinión' } });
    expect(again.json()).toMatchObject({ code: 'invalid_transition' });

    const staffList = await app.inject({ method: 'GET', url: '/api/booking/reviews?status=pending', headers: auth(biz.session) });
    expect(staffList.json()).toMatchObject([{ rating: 5, comment: 'Muy buen corte', status: 'pending' }]);
    expect(JSON.stringify(staffList.json())).not.toMatch(/laura|correo|573/i); // sin datos de contacto del cliente

    // No la muestra la página pública hasta que el negocio la apruebe.
    expect(await (await app.inject({ method: 'GET', url: `${biz.base}/reviews` })).json()).toEqual([]);
    const reviewId = staffList.json<Array<{ id: string }>>()[0]!.id;
    await app.inject({ method: 'PATCH', url: `/api/booking/reviews/${reviewId}`, headers: auth(biz.session), payload: { status: 'approved' } });
    expect((await (await app.inject({ method: 'GET', url: `${biz.base}/reviews` })).json()).length).toBe(1);
  });

  it('el nombre público de la reseña es "Nombre inicial." (nunca el nombre completo ni datos de contacto)', async () => {
    const biz = await setupBiz(app, 'Reseñar nombre');
    const token = await completed(biz);
    await app.inject({ method: 'POST', url: `${biz.base}/appointments/${token}/review`, payload: { rating: 4, comment: '' } });
    const staffList = await app.inject({ method: 'GET', url: '/api/booking/reviews', headers: auth(biz.session) });
    expect(staffList.json<Array<{ authorName: string }>>()[0]!.authorName).toBe('Ana P.'); // "Ana Pérez" del helper publicPayload
  });

  it('un token de otro negocio no puede reseñar, y valida la calificación', async () => {
    const a = await setupBiz(app, 'Reseñar A');
    const b = await setupBiz(app, 'Reseñar B');
    const tokenB = await completed(b);
    expect((await app.inject({ method: 'POST', url: `${a.base}/appointments/${tokenB}/review`, payload: { rating: 5, comment: '' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${b.base}/appointments/${tokenB}/review`, payload: { rating: 6, comment: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `${b.base}/appointments/${tokenB}/review`, payload: { rating: 0, comment: '' } })).statusCode).toBe(400);
  });
});
