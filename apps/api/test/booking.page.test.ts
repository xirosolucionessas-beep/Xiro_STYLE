import type { BookingAdminSettings, PublicAppointmentDto, PublicBookingProfile, PublicBookingResult } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import type { BookingContext } from '../src/booking/availability';
import { openStatus } from '../src/booking/view';
import { appointments, clients } from '../src/db/schema';
import { at, auth, book, publicPayload, register, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Contexto mínimo (zona de Bogotá, UTC-5): lunes a sábado 09:00–19:00, domingo cerrado. */
const week = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, from: '09:00', to: '19:00' }));
const ctxOf = (weekly: Array<{ weekday: number; from: string; to: string }>, closures: string[] = []) =>
  ({ business: { timezone: 'America/Bogota' }, weekly, closures: new Set(closures) }) as unknown as BookingContext;

describe('openStatus: cuándo cambia el estado del negocio (en su zona horaria)', () => {
  const ctx = ctxOf(week);
  it('abierto: la hora de cierre de hoy', () => {
    expect(openStatus(ctx, new Date('2026-09-30T15:00:00Z'))).toEqual({ open: true, changesAt: '2026-10-01T00:00:00.000Z' }); // miércoles 10:00 → cierra 19:00 (00:00Z)
  });
  it('cerrado antes de abrir: abre hoy más tarde', () => {
    expect(openStatus(ctx, new Date('2026-09-30T12:00:00Z'))).toEqual({ open: false, changesAt: '2026-09-30T14:00:00.000Z' }); // 07:00 → abre 09:00
  });
  it('cerrado después de cerrar: abre mañana', () => {
    expect(openStatus(ctx, new Date('2026-10-01T02:00:00Z'))).toEqual({ open: false, changesAt: '2026-10-01T14:00:00.000Z' }); // miércoles 21:00 → jueves 09:00
  });
  it('salta los días sin horario (domingo) y los cierres puntuales', () => {
    expect(openStatus(ctx, new Date('2026-10-04T02:00:00Z'))).toEqual({ open: false, changesAt: '2026-10-05T14:00:00.000Z' }); // sábado 21:00 → lunes
    expect(openStatus(ctxOf(week, ['2026-10-01']), new Date('2026-10-01T02:00:00Z'))).toEqual({ open: false, changesAt: '2026-10-02T14:00:00.000Z' }); // jueves festivo → viernes
  });
  it('un día festivo hoy: cerrado aunque sea su horario', () => {
    expect(openStatus(ctxOf(week, ['2026-09-30']), new Date('2026-09-30T15:00:00Z'))).toEqual({ open: false, changesAt: '2026-10-01T14:00:00.000Z' });
  });
  it('sin ningún horario en 14 días no hay próxima apertura', () => {
    expect(openStatus(ctxOf([]), new Date('2026-09-30T15:00:00Z'))).toEqual({ open: false, changesAt: null });
  });
});

let testDb: TestDatabase;
let app: FastifyInstance;
let cleanup: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase({ poolMax: 20 });
  const setup = testAppConfig();
  cleanup = setup.cleanup;
  app = await buildApp({ db: testDb.db, config: setup.config});
});
afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});
afterEach(() => vi.unstubAllGlobals());

const profileOf = async (base: string) => (await app.inject({ method: 'GET', url: base })).json<PublicBookingProfile>();
const settingsOf = async (biz: { session: Parameters<typeof auth>[0] }) => (await app.inject({ method: 'GET', url: '/api/booking/settings', headers: auth(biz.session) })).json<BookingAdminSettings>();

describe('¿se puede reservar en línea? (acceptsBookings / readiness)', () => {
  it('con servicio reservable, alguien que atiende y horario: sí — y el checklist del dueño lo confirma', async () => {
    const biz = await setupBiz(app, 'Listo');
    expect((await profileOf(biz.base)).acceptsBookings).toBe(true);
    const { readiness } = await settingsOf(biz);
    expect(readiness).toMatchObject({ published: true, bookableServices: 1, bookableProfessionals: 1, ready: true });
    expect(readiness.openDays).toBeGreaterThan(0);
  });

  it('sin servicios reservables (el caso de "derek": solo un producto): no, y se sabe exactamente qué falta', async () => {
    const session = await register(app, 'Solo producto');
    await app.inject({ method: 'PATCH', url: `/api/professionals/${session.user.id}`, headers: auth(session), payload: { bookable: true } });
    await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(session), payload: { published: true } });
    const base = `/api/public/booking/${session.business.slug}`;
    expect((await profileOf(base)).acceptsBookings).toBe(false);
    expect((await settingsOf({ session })).readiness).toMatchObject({ bookableServices: 0, bookableProfessionals: 1, ready: false });
  });

  it('con servicio pero sin nadie que atienda (el dueño no marcó "yo también atiendo"): no', async () => {
    const biz = await setupBiz(app, 'Sin profesional');
    await app.inject({ method: 'PATCH', url: `/api/professionals/${biz.ownerId}`, headers: auth(biz.session), payload: { bookable: false } });
    expect((await profileOf(biz.base)).acceptsBookings).toBe(false);
    expect((await settingsOf(biz)).readiness).toMatchObject({ bookableServices: 1, bookableProfessionals: 0, ready: false });
  });

  it('el perfil público trae el estado de apertura', async () => {
    const biz = await setupBiz(app, 'Estado');
    const profile = await profileOf(biz.base);
    expect(typeof profile.openStatus.open).toBe('boolean');
    expect(profile.openStatus.open).toBe(profile.openNow);
    expect(profile.openStatus.changesAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

const rowsOf = async (businessId: string) => testDb.db.select().from(appointments).where(eq(appointments.businessId, businessId));

/**
 * Ejecuta `run` y, en la `nth` consulta SQL que cumpla `match`, ejecuta `interleave` hasta el final (antes de enviar esa
 * consulta o después de recibir su resultado). Orden exacto y repetible, sin esperas por tiempo. Falla si nunca ocurrió.
 */
async function pauseAtQuery<T>(match: (text: string) => boolean, nth: number, when: 'before' | 'after', interleave: () => Promise<void>, run: () => Promise<T>): Promise<T> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = proto.query;
  let seen = 0;
  let fired = false;
  proto.query = function (this: unknown, ...args: unknown[]) {
    const first = args[0] as string | { text?: string } | undefined;
    const text = typeof first === 'string' ? first : (first?.text ?? '');
    if (!fired && match(text) && ++seen === nth) {
      fired = true;
      proto.query = original; // lo que haga `interleave` no se intercepta
      if (when === 'before') return interleave().then(() => original.apply(this, args));
      return Promise.resolve(original.apply(this, args)).then(async (result) => {
        await interleave();
        return result;
      });
    }
    return original.apply(this, args);
  };
  try {
    const result = await run();
    expect(fired, 'la consulta a interceptar nunca ocurrió: la prueba no reprodujo la carrera').toBe(true);
    return result;
  } finally {
    proto.query = original;
  }
}

describe('confirmación idempotente', () => {
  it('repetir la MISMA confirmación devuelve la misma cita y el mismo enlace: no crea otra ni dice "horario ocupado"', async () => {
    const biz = await setupBiz(app, 'Idem');
    const idempotencyKey = crypto.randomUUID();
    const date = workday(3);
    const first = await book(app, biz, date, '10:00', { idempotencyKey });
    const second = await book(app, biz, date, '10:00', { idempotencyKey });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json<PublicBookingResult>().token).toBe(first.json<PublicBookingResult>().token);
    expect(second.json<PublicBookingResult>().appointment).toEqual(first.json<PublicBookingResult>().appointment);
    expect(await rowsOf(biz.session.business.id)).toHaveLength(1);
    // El enlace devuelto en el reintento sirve de verdad.
    const managed = await app.inject({ method: 'GET', url: `${biz.base}/appointments/${second.json<PublicBookingResult>().token}` });
    expect(managed.statusCode).toBe(200);
  });

  it('sin clave, cada envío cuenta como nuevo (y el segundo sobre el mismo horario sigue siendo "horario ocupado")', async () => {
    const biz = await setupBiz(app, 'SinClave');
    const date = workday(3);
    expect((await book(app, biz, date, '10:00')).statusCode).toBe(201);
    expect((await book(app, biz, date, '10:00')).statusCode).toBe(409);
  });

  it('una clave distinta sobre el mismo horario NO es un reintento: otra persona lo ocupó primero', async () => {
    const biz = await setupBiz(app, 'OtraClave');
    const date = workday(3);
    expect((await book(app, biz, date, '10:00', { idempotencyKey: crypto.randomUUID() })).statusCode).toBe(201);
    expect((await book(app, biz, date, '10:00', { idempotencyKey: crypto.randomUUID() })).statusCode).toBe(409);
  });

  it('cinco envíos simultáneos con la misma clave: una sola cita y todos reciben el mismo enlace', async () => {
    const biz = await setupBiz(app, 'Carrera');
    const idempotencyKey = crypto.randomUUID();
    const date = workday(4);
    const results = await Promise.all(Array.from({ length: 5 }, () => book(app, biz, date, '11:00', { idempotencyKey })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.json<PublicBookingResult>().token)).size).toBe(1);
    expect(await rowsOf(biz.session.business.id)).toHaveLength(1);
  });

  // Carrera determinista (sin temporizadores): se detiene el segundo envío en un punto exacto de su transacción, el primero
  // se completa y se confirma entero, y luego el segundo sigue. Antes respondía 409/429 aunque esa clave ya tenía su cita.
  const sameAttempt = (biz: Biz, date: string, time: string) => publicPayload(biz, date, time, { idempotencyKey: crypto.randomUUID() });
  const send = (biz: Biz, payload: object) => app.inject({ method: 'POST', url: `${biz.base}/appointments`, payload });

  it('el primer envío se confirma después de que el segundo buscó la clave: el segundo recibe esa misma cita, no "horario ocupado"', async () => {
    const biz = await setupBiz(app, 'Carrera horario');
    const payload = sameAttempt(biz, workday(4), '11:00');
    let first: Awaited<ReturnType<typeof send>> | undefined;
    // 1.ª búsqueda de la clave: la de la ruta; 2.ª: la de createAppointment, justo antes de evaluar el horario.
    const second = await pauseAtQuery((text) => /^select/i.test(text) && text.includes('"idempotency_hash" = $'), 2, 'after', async () => {
      first = await send(biz, payload);
    }, () => send(biz, payload));
    expect(first?.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json<PublicBookingResult>().token).toBe(first!.json<PublicBookingResult>().token);
    expect(second.json<PublicBookingResult>().appointment).toEqual(first!.json<PublicBookingResult>().appointment);
    expect(await rowsOf(biz.session.business.id)).toHaveLength(1);
  });

  it('el primer envío se confirma después de que el segundo vio el horario libre: con tope de 1 pendiente, el segundo recibe esa cita, no "demasiadas pendientes"', async () => {
    const biz = await setupBiz(app, 'Carrera pendientes');
    expect((await app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload: { maxPendingPerPhone: 1 } })).statusCode).toBe(200);
    const payload = sameAttempt(biz, workday(4), '11:00');
    let first: Awaited<ReturnType<typeof send>> | undefined;
    // El bloqueo por teléfono del cliente llega después de evaluar el horario y antes de contar sus citas pendientes.
    const second = await pauseAtQuery((text) => text.includes('pg_advisory_xact_lock'), 1, 'before', async () => {
      first = await send(biz, payload);
    }, () => send(biz, payload));
    expect(first?.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json<PublicBookingResult>().token).toBe(first!.json<PublicBookingResult>().token);
    expect(await rowsOf(biz.session.business.id)).toHaveLength(1);
  });

  it('la clave ya usada con OTRO horario no reserva ese horario: devuelve la cita original y el otro horario sigue libre para los demás', async () => {
    const biz = await setupBiz(app, 'Clave reutilizada');
    const date = workday(4);
    const payload = sameAttempt(biz, date, '11:00');
    const first = await send(biz, payload);
    expect(first.statusCode).toBe(201);
    const reused = await send(biz, { ...payload, startsAt: at(date, '14:00') });
    expect(reused.statusCode).toBe(200);
    expect(reused.json<PublicBookingResult>().appointment).toEqual(first.json<PublicBookingResult>().appointment);
    expect(await rowsOf(biz.session.business.id)).toHaveLength(1);
    expect((await book(app, biz, date, '14:00')).statusCode).toBe(201);
    // Y un conflicto real se sigue respetando: otra clave sobre el horario ya tomado es "horario ocupado".
    expect((await book(app, biz, date, '11:00', { idempotencyKey: crypto.randomUUID() })).statusCode).toBe(409);
  });

  it('la clave es por negocio: la misma clave en otro negocio no devuelve la cita del primero', async () => {
    const a = await setupBiz(app, 'A idem');
    const b = await setupBiz(app, 'B idem');
    const idempotencyKey = crypto.randomUUID();
    const date = workday(3);
    const inA = await book(app, a, date, '10:00', { idempotencyKey });
    const inB = await book(app, b, date, '10:00', { idempotencyKey });
    expect(inB.statusCode).toBe(201);
    expect(inB.json<PublicBookingResult>().token).not.toBe(inA.json<PublicBookingResult>().token);
    expect(await rowsOf(a.session.business.id)).toHaveLength(1);
    expect(await rowsOf(b.session.business.id)).toHaveLength(1);
  });

  it('el reintento no exige otro captcha (el token de Turnstile es de un solo uso y ya se gastó)', async () => {
    const setup = testAppConfig({ booking: { turnstileSecret: 'secreto' } });
    const guarded = await buildApp({ db: testDb.db, config: setup.config });
    try {
      const biz = await setupBiz(guarded, 'Captcha idem');
      let uses = 0;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: uses++ === 0 }), { status: 200 })));
      const idempotencyKey = crypto.randomUUID();
      const date = workday(3);
      const first = await book(guarded, biz, date, '10:00', { idempotencyKey, captchaToken: 'token-de-un-uso' });
      const again = await book(guarded, biz, date, '10:00', { idempotencyKey, captchaToken: 'token-de-un-uso' });
      expect(first.statusCode).toBe(201);
      expect(again.statusCode).toBe(200);
      // Y sin clave de idempotencia, el mismo token gastado sí se rechaza.
      const other = await book(guarded, biz, workday(4), '10:00', { captchaToken: 'token-de-un-uso' });
      expect(other.statusCode).toBe(400);
    } finally {
      await guarded.close();
      setup.cleanup();
    }
  });

  it('una clave que no es UUID se rechaza', async () => {
    const biz = await setupBiz(app, 'Clave mala');
    expect((await book(app, biz, workday(3), '10:00', { idempotencyKey: 'no-es-un-uuid' })).statusCode).toBe(400);
  });
});

describe('clientes: un celular, un cliente por negocio', () => {
  it('dos reservas simultáneas con el mismo celular en el mismo negocio crean UN solo cliente', async () => {
    const biz = await setupBiz(app, 'Cliente unico');
    const customer = { firstName: 'Laura', lastName: 'Gómez', email: 'laura@correo.com', phone: '3009998877', notes: '', custom: {} };
    const date = workday(3);
    const results = await Promise.all(['10:00', '12:00', '14:00'].map((time) => book(app, biz, date, time, { customer })));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    const found = await testDb.db.select().from(clients).where(eq(clients.businessId, biz.session.business.id)); // el celular se guarda normalizado (57…): se cuenta por negocio
    expect(found).toHaveLength(1);
  });

  it('el mismo celular en dos negocios son dos clientes independientes (nada se comparte)', async () => {
    const a = await setupBiz(app, 'Cel A');
    const b = await setupBiz(app, 'Cel B');
    const customer = { firstName: 'Ana', lastName: 'Ruiz', email: 'ana@correo.com', phone: '3001234567', notes: 'nota de A', custom: {} };
    await book(app, a, workday(3), '10:00', { customer });
    await book(app, b, workday(3), '10:00', { customer: { ...customer, notes: 'nota de B' } });
    const inA = await testDb.db.select().from(clients).where(eq(clients.businessId, a.session.business.id));
    const inB = await testDb.db.select().from(clients).where(eq(clients.businessId, b.session.business.id));
    expect(inA).toHaveLength(1);
    expect(inB).toHaveLength(1);
    expect(inA[0]!.id).not.toBe(inB[0]!.id);
  });
});

describe('la cita en la respuesta pública: nombre a mostrar y "cómo llegar"', () => {
  it('usa el nombre público de la página y trae el pin solo si la sección del mapa sigue activa', async () => {
    const biz = await setupBiz(app, 'Nombre');
    await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { displayName: 'Xiro Beauty Studio', latitude: 4.6533, longitude: -74.0836, mapAddress: 'Cra. 7 #71-21, Bogotá', placeId: 'ChIJ_lugar_de_prueba_123' } });
    const withPin = (await book(app, biz, workday(3), '10:00')).json<PublicBookingResult>().appointment;
    expect(withPin.business.name).toBe('Xiro Beauty Studio');
    expect(withPin.business.location).toEqual({ latitude: 4.6533, longitude: -74.0836, placeId: 'ChIJ_lugar_de_prueba_123', address: 'Cra. 7 #71-21, Bogotá' });

    await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { sections: { map: false } } });
    const hidden = (await book(app, biz, workday(3), '12:00')).json<PublicBookingResult>().appointment;
    expect(hidden.business.location).toBeNull();
  });

  it('sin ubicación guardada, location es null', async () => {
    const biz = await setupBiz(app, 'Sin pin');
    const dto: PublicAppointmentDto = (await book(app, biz, workday(3), '10:00')).json<PublicBookingResult>().appointment;
    expect(dto.business.location).toBeNull();
  });
});
