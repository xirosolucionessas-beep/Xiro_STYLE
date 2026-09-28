import type { AppointmentDto, BookingAdminSettings, ClassificationEntry, ProfessionalDto, PublicBookingProfile, PublicBookingResult, PublicReviewDto } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { appointments, reviews } from '../src/db/schema';
import { at, auth, availability, book, createEmployee, createService, nextPhone, register, setupBiz, stateAt, workday, type Biz } from './helpers/booking';
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

const send = (session: { accessToken: string }, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(session), payload: payload as object | undefined });

const staffBody = (biz: Biz, professionalId: string, date: string, time: string, over: Record<string, unknown> = {}) => ({
  professionalId,
  startsAt: at(date, time),
  selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [] },
  newClient: { name: 'Cliente Mostrador', phone: nextPhone() },
  ...over,
});

/** Negocio con el dueño y un empleado ("Luis") que también atienden. */
async function withLuis(permissions: Parameters<typeof createEmployee>[2] = []) {
  const biz = await setupBiz(app, 'Equipo');
  const luis = await createEmployee(app, biz.session, permissions);
  expect((await send(biz.session, 'PATCH', `/api/professionals/${luis.employee.id}`, { bookable: true, publicName: 'Luis' })).statusCode).toBe(200);
  return { biz, luis };
}

describe('permisos de la agenda', () => {
  it('sin permisos un empleado no ve la agenda, no agenda, no gestiona la página ni el catálogo de servicios', async () => {
    const { biz, luis } = await withLuis([]);
    const date = workday(4);
    const range = `from=${at(date, '00:00')}&to=${at(date, '23:59')}`;
    for (const [method, url, payload] of [
      ['GET', `/api/appointments?${range}`, undefined],
      ['POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:00')],
      ['GET', '/api/booking/settings', undefined],
      ['PUT', '/api/booking/settings', {}],
      ['PUT', '/api/booking/slug', { slug: 'otro-nombre' }],
      ['GET', '/api/booking/closures', undefined],
      ['GET', '/api/professionals', undefined],
      ['PATCH', `/api/professionals/${biz.ownerId}`, { bookable: false }],
      ['GET', '/api/packages', undefined],
      ['POST', '/api/packages', { name: 'x', price: 1, entries: [{ itemId: biz.serviceId }] }],
      ['GET', '/api/items/classification', undefined],
      ['GET', `/api/booking/availability?date=${date}&services=${biz.serviceId}`, undefined],
      ['GET', '/api/booking/reviews', undefined],
    ] as const) {
      expect((await send(luis.session, method, url, payload)).statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('agenda_own: ve solo sus citas; las del resto responden 404 (no confirma que existan)', async () => {
    const { biz, luis } = await withLuis(['agenda_own']);
    const date = workday(4);
    const forOwner = (await book(app, biz, date, '10:00', { professionalId: biz.ownerId })).json<PublicBookingResult>();
    const forLuis = (await book(app, biz, date, '10:00', { professionalId: luis.employee.id })).json<PublicBookingResult>();
    expect(forOwner.appointment.status).toBe('confirmed');
    expect(forLuis.appointment.status).toBe('confirmed');

    const range = `from=${at(date, '00:00')}&to=${at(date, '23:59')}`;
    const mine = await send(luis.session, 'GET', `/api/appointments?${range}`);
    expect(mine.statusCode).toBe(200);
    const list = mine.json<AppointmentDto[]>();
    expect(list).toHaveLength(1);
    expect(list[0]!.professional.id).toBe(luis.employee.id);
    // Pedir la agenda de otra persona no amplía lo que ve.
    expect((await send(luis.session, 'GET', `/api/appointments?${range}&professionalId=${biz.ownerId}`)).json<AppointmentDto[]>().every((a) => a.professional.id === luis.employee.id)).toBe(true);

    const all = (await send(biz.session, 'GET', `/api/appointments?${range}`)).json<AppointmentDto[]>();
    expect(all).toHaveLength(2);
    const ownerAppt = all.find((a) => a.professional.id === biz.ownerId)!;
    expect((await send(luis.session, 'GET', `/api/appointments/${ownerAppt.id}`)).statusCode).toBe(404);
    expect((await send(luis.session, 'GET', `/api/appointments/${list[0]!.id}`)).statusCode).toBe(200);
    // Sin appointments_manage no puede cambiar nada, ni siquiera lo suyo.
    expect((await send(luis.session, 'POST', `/api/appointments/${list[0]!.id}/status`, { status: 'cancelled' })).statusCode).toBe(403);
  });

  it('appointments_manage sin agenda_all: crea y cambia solo sus propias citas', async () => {
    const { biz, luis } = await withLuis(['appointments_manage']);
    const date = workday(4);
    const forOwner = (await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:00'))).json<AppointmentDto>();

    expect((await send(luis.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '12:00'))).statusCode).toBe(403); // agenda de otra persona
    const own = await send(luis.session, 'POST', '/api/appointments', staffBody(biz, luis.employee.id, date, '12:00'));
    expect(own.statusCode).toBe(201);
    const ownId = own.json<AppointmentDto>().id;

    expect((await send(luis.session, 'PATCH', `/api/appointments/${forOwner.id}`, { internalNotes: 'x' })).statusCode).toBe(404);
    expect((await send(luis.session, 'POST', `/api/appointments/${forOwner.id}/status`, { status: 'cancelled' })).statusCode).toBe(404);
    expect((await send(luis.session, 'PATCH', `/api/appointments/${ownId}`, { professionalId: biz.ownerId })).statusCode).toBe(403); // no puede pasársela a otro
    expect((await send(luis.session, 'PATCH', `/api/appointments/${ownId}`, { internalNotes: 'llegó tarde' })).json<AppointmentDto>().internalNotes).toBe('llegó tarde');
    expect((await send(luis.session, 'POST', `/api/appointments/${ownId}/status`, { status: 'cancelled', reason: 'no vino' })).json<AppointmentDto>().status).toBe('cancelled');
    // La cita del dueño no se tocó.
    expect((await send(biz.session, 'GET', `/api/appointments/${forOwner.id}`)).json<AppointmentDto>()).toMatchObject({ status: 'confirmed', internalNotes: '' });
  });

  it('agenda_all: ve y agenda en cualquier profesional', async () => {
    const { biz, luis } = await withLuis(['agenda_all', 'appointments_manage']);
    const date = workday(4);
    await book(app, biz, date, '10:00', { professionalId: biz.ownerId });
    const range = `from=${at(date, '00:00')}&to=${at(date, '23:59')}`;
    expect((await send(luis.session, 'GET', `/api/appointments?${range}`)).json()).toHaveLength(1);
    expect((await send(luis.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '13:00'))).statusCode).toBe(201);
    expect((await send(luis.session, 'GET', '/api/professionals')).statusCode).toBe(200);
  });

  it('public_page_manage: el dueño y quien tenga el permiso; los demás no', async () => {
    const { biz, luis } = await withLuis(['public_page_manage']);
    expect((await send(luis.session, 'GET', '/api/booking/settings')).statusCode).toBe(200);
    expect((await send(luis.session, 'PUT', '/api/booking/profile', { tagline: 'Hecho por Luis' })).statusCode).toBe(200);
    expect((await send(biz.session, 'GET', '/api/booking/settings')).json<BookingAdminSettings>().profile.tagline).toBe('Hecho por Luis');
    const other = await createEmployee(app, biz.session, ['appointments_manage']);
    expect((await send(other.session, 'PUT', '/api/booking/profile', { tagline: 'hackeo' })).statusCode).toBe(403);
  });

  it('cada persona gestiona sus propias ausencias; las de otros exigen ver todas las agendas', async () => {
    const { biz, luis } = await withLuis(['agenda_own']);
    const date = workday(4);
    const body = { startsAt: at(date, '09:00'), endsAt: at(date, '12:00'), reason: 'Trámite' };
    expect((await send(luis.session, 'POST', `/api/professionals/${luis.employee.id}/time-off`, body)).statusCode).toBe(201);
    expect((await send(luis.session, 'POST', `/api/professionals/${biz.ownerId}/time-off`, body)).statusCode).toBe(403);
    expect((await send(luis.session, 'GET', `/api/professionals/${biz.ownerId}/time-off`)).statusCode).toBe(403);
    const off = (await send(luis.session, 'GET', `/api/professionals/${luis.employee.id}/time-off`)).json<Array<{ id: string }>>();
    expect(off).toHaveLength(1);
    expect(stateAt((await availability(app, biz, date, `&professionalId=${luis.employee.id}`)).body.slots, '10:00')).toBe('unavailable');
    expect((await send(luis.session, 'DELETE', `/api/time-off/${off[0]!.id}`)).statusCode).toBe(204);
    expect(stateAt((await availability(app, biz, date, `&professionalId=${luis.employee.id}`)).body.slots, '10:00')).toBe('available');
  });

  it('los empleados también registran sus dispositivos de notificaciones (push)', async () => {
    const { luis } = await withLuis([]);
    const token = 'ExponentPushToken[empleado-de-prueba]';
    expect((await send(luis.session, 'POST', '/api/notifications/register', { platform: 'expo', token })).statusCode).toBe(200);
    expect((await send(luis.session, 'GET', '/api/notifications/vapid-public-key')).statusCode).toBe(200);
    expect((await send(luis.session, 'DELETE', '/api/notifications/register', { token })).statusCode).toBe(200);
    // Las preferencias del negocio siguen siendo del dueño.
    expect((await send(luis.session, 'GET', '/api/notifications/settings')).statusCode).toBe(403);
  });
});

describe('agenda del personal', () => {
  it('crea una cita de mostrador, evita el cruce y permite agendar más allá del horizonte público', async () => {
    const biz = await setupBiz(app, 'Mostrador');
    await send(biz.session, 'PUT', '/api/booking/settings', { maxDaysAhead: 5 });
    const date = workday(4);
    const created = await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:00', { internalNotes: 'Prefiere silla 2', source: 'walk_in' }));
    expect(created.statusCode).toBe(201);
    expect(created.json<AppointmentDto>()).toMatchObject({ status: 'confirmed', source: 'walk_in', internalNotes: 'Prefiere silla 2', totalPrice: 30000, client: { name: 'Cliente Mostrador' } });

    const clash = await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:30'));
    expect(clash.statusCode).toBe(409);
    expect(clash.json<{ alternatives: unknown[] }>().alternatives.length).toBeGreaterThan(0);

    const far = workday(30);
    expect(stateAt((await availability(app, biz, far)).body.slots, '10:00')).toBe('unavailable'); // público: fuera del horizonte
    const staffView = await send(biz.session, 'GET', `/api/booking/availability?date=${far}&services=${biz.serviceId}`);
    expect(stateAt(staffView.json<{ slots: Array<{ time: string; state: string }> }>().slots, '10:00')).toBe('available'); // personal: sí
    expect((await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, far, '10:00'))).statusCode).toBe(201);
  });

  it('valida qué se puede agendar: cliente o cliente nuevo (no ambos), rango de fechas y ids', async () => {
    const biz = await setupBiz(app, 'Valid');
    const date = workday(4);
    expect((await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:00', { newClient: undefined }))).statusCode).toBe(400);
    expect((await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:00', { clientId: '00000000-0000-4000-8000-000000000000' }))).statusCode).toBe(400);
    expect((await send(biz.session, 'GET', `/api/appointments?from=${at(date, '00:00')}&to=${at(workday(400), '00:00')}`)).statusCode).toBe(400);
    expect((await send(biz.session, 'GET', `/api/appointments?from=${at(date, '10:00')}&to=${at(date, '09:00')}`)).statusCode).toBe(400);
    expect((await send(biz.session, 'GET', '/api/appointments/no-es-uuid')).statusCode).toBe(404);
  });

  it('estados: solo transiciones válidas, y cancelar libera el horario', async () => {
    const biz = await setupBiz(app, 'Estados');
    await send(biz.session, 'PUT', '/api/booking/settings', { autoConfirm: false });
    const date = workday(4);
    const pending = (await book(app, biz, date, '10:00')).json<PublicBookingResult>();
    const list = (await send(biz.session, 'GET', `/api/appointments?from=${at(date, '00:00')}&to=${at(date, '23:59')}`)).json<AppointmentDto[]>();
    const id = list[0]!.id;
    expect(pending.appointment.status).toBe('pending');
    const status = (to: string) => send(biz.session, 'POST', `/api/appointments/${id}/status`, { status: to });

    expect((await status('completed')).statusCode).toBe(409); // pendiente → completada no existe
    expect((await status('confirmed')).json<AppointmentDto>().status).toBe('confirmed');
    expect((await status('no_show')).statusCode).toBe(409); // todavía no llegó la hora
    expect((await status('in_progress')).json<AppointmentDto>().status).toBe('in_progress');
    expect((await status('completed')).json<AppointmentDto>().status).toBe('completed');
    expect((await status('cancelled')).statusCode).toBe(409); // una completada ya no cambia
    expect((await status('pending')).statusCode).toBe(409);

    const second = (await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '13:00'))).json<AppointmentDto>();
    expect(stateAt((await availability(app, biz, date)).body.slots, '13:00')).toBe('booked');
    await send(biz.session, 'POST', `/api/appointments/${second.id}/status`, { status: 'cancelled', reason: 'Se enfermó' });
    expect(stateAt((await availability(app, biz, date)).body.slots, '13:00')).toBe('available');
    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.id, second.id));
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'Se enfermó' });
  });

  it('mover una cita revalida el horario y conserva el precio pactado', async () => {
    const biz = await setupBiz(app, 'Mover');
    const date = workday(4);
    const a = (await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:00'))).json<AppointmentDto>();
    await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '14:00'));
    await send(biz.session, 'PUT', `/api/items/${biz.serviceId}`, { name: 'Corte', categoryId: (await send(biz.session, 'GET', '/api/categories')).json<Array<{ id: string }>>()[0]!.id, price: 99000, kind: 'service' });

    expect((await send(biz.session, 'PATCH', `/api/appointments/${a.id}`, { startsAt: at(date, '14:30') })).statusCode).toBe(409);
    const moved = await send(biz.session, 'PATCH', `/api/appointments/${a.id}`, { startsAt: at(date, '16:00') });
    expect(moved.statusCode).toBe(200);
    expect(moved.json<AppointmentDto>()).toMatchObject({ startsAt: at(date, '16:00'), endsAt: at(date, '17:00'), totalPrice: 30000, modificationCount: 0 });
    expect(stateAt((await availability(app, biz, date)).body.slots, '10:00')).toBe('available');
  });
});

describe('servicios: estilos, paquetes, profesionales y clasificación', () => {
  it('cada profesional solo atiende sus servicios, con su horario y sus precios propios', async () => {
    const { biz, luis } = await withLuis([]);
    const barba = await createService(app, biz.session, { name: 'Barba', price: 15000, durationMinutes: 30 });
    const date = workday(4);

    // Luis solo hace "Corte", a $20.000, y trabaja de 13:00 a 15:00.
    expect((await send(biz.session, 'PUT', `/api/professionals/${luis.employee.id}/services`, { services: [{ itemId: biz.serviceId, priceOverride: 20000 }] })).json<ProfessionalDto>().serviceIds).toEqual([biz.serviceId]);
    expect((await send(biz.session, 'PUT', `/api/professionals/${luis.employee.id}/schedule`, { blocks: [{ weekday: 1, from: '13:00', to: '15:00' }, { weekday: 2, from: '13:00', to: '15:00' }, { weekday: 3, from: '13:00', to: '15:00' }, { weekday: 4, from: '13:00', to: '15:00' }, { weekday: 5, from: '13:00', to: '15:00' }, { weekday: 6, from: '13:00', to: '15:00' }] })).statusCode).toBe(200);

    const slots = (await availability(app, biz, date, `&professionalId=${luis.employee.id}`)).body.slots;
    expect(stateAt(slots, '10:00')).toBe('unavailable');
    expect(stateAt(slots, '13:00')).toBe('available');
    expect(stateAt(slots, '14:00')).toBe('available');
    expect(stateAt(slots, '14:30')).toBe('unavailable'); // 60 min ya no caben antes de las 15:00

    const bad = await book(app, biz, date, '13:00', { professionalId: luis.employee.id, selection: { services: [{ itemId: barba.id }], packages: [], products: [] } });
    expect(bad.json()).toMatchObject({ code: 'professional_unavailable' });
    const priced = await book(app, biz, date, '13:00', { professionalId: luis.employee.id });
    expect(priced.json<PublicBookingResult>().appointment).toMatchObject({ totalPrice: 20000, professionalName: 'Luis' });
    // Barba con "primero disponible" siempre cae en el dueño.
    const any = await book(app, biz, date, '13:00', { selection: { services: [{ itemId: barba.id }], packages: [], products: [] } });
    expect(any.json<PublicBookingResult>().appointment.professionalName).toBe('La Dueña');

    expect((await send(biz.session, 'PUT', `/api/professionals/${luis.employee.id}/schedule`, { blocks: [{ weekday: 1, from: '09:00', to: '12:00' }, { weekday: 1, from: '11:00', to: '13:00' }] })).statusCode).toBe(400); // bloques que se cruzan
  });

  it('estilos y paquetes: alta, edición, baja y validaciones', async () => {
    const biz = await setupBiz(app, 'Catalogo');
    const variant = await send(biz.session, 'POST', `/api/items/${biz.serviceId}/variants`, { name: 'Fade', price: 40000, durationMinutes: 45 });
    expect(variant.statusCode).toBe(201);
    const id = variant.json<{ id: string }>().id;
    expect((await send(biz.session, 'PUT', `/api/variants/${id}`, { name: 'Fade alto', price: 42000, durationMinutes: null, active: false })).json()).toMatchObject({ name: 'Fade alto', price: 42000, durationMinutes: null, active: false });
    expect((await send(biz.session, 'POST', `/api/items/${biz.serviceId}/variants`, { name: '', price: 1 })).statusCode).toBe(400);
    expect((await send(biz.session, 'POST', `/api/items/${biz.serviceId}/variants`, { name: 'Malo', price: -5 })).statusCode).toBe(400);
    // Un estilo inactivo ya no se puede reservar ni se muestra.
    expect((await book(app, biz, workday(4), '10:00', { selection: { services: [{ itemId: biz.serviceId, variantId: id }], packages: [], products: [] } })).json()).toMatchObject({ code: 'item_not_bookable' });
    expect((await app.inject({ method: 'GET', url: `${biz.base}/catalog` })).json<{ services: Array<{ variants: unknown[] }> }>().services[0]!.variants).toEqual([]);
    expect((await send(biz.session, 'DELETE', `/api/variants/${id}`)).statusCode).toBe(204);

    const pkg = await send(biz.session, 'POST', '/api/packages', { name: 'Combo', price: 50000, entries: [{ itemId: biz.serviceId }] });
    expect(pkg.statusCode).toBe(201);
    const pid = pkg.json<{ id: string }>().id;
    expect((await send(biz.session, 'PUT', `/api/packages/${pid}`, { name: 'Combo VIP', price: 60000, entries: [{ itemId: biz.serviceId }], visibleOnWeb: false })).json()).toMatchObject({ name: 'Combo VIP', visibleOnWeb: false });
    expect((await app.inject({ method: 'GET', url: `${biz.base}/catalog` })).json<{ packages: unknown[] }>().packages).toEqual([]); // oculto en la web
    expect((await send(biz.session, 'GET', '/api/packages')).json()).toHaveLength(1);
    expect((await send(biz.session, 'POST', '/api/packages', { name: 'Vacío', price: 1, entries: [] })).statusCode).toBe(400);
    expect((await send(biz.session, 'DELETE', `/api/packages/${pid}`)).statusCode).toBe(204);
    expect((await send(biz.session, 'DELETE', `/api/packages/${pid}`)).statusCode).toBe(404);
  });

  it('revisión "Revisa tus servicios y productos": propone por existencias y el dueño confirma o cambia', async () => {
    const biz = await setupBiz(app, 'Revision');
    const categoryId = (await send(biz.session, 'GET', '/api/categories')).json<Array<{ id: string }>>()[0]!.id;
    // Artículos creados como antes (sin `kind`), como haría una app ya instalada.
    const shampoo = (await send(biz.session, 'POST', '/api/items', { name: 'Shampoo', categoryId, price: 20000, stock: 5 })).json<{ id: string; kind: string; kindConfirmed: boolean }>();
    const masaje = (await send(biz.session, 'POST', '/api/items', { name: 'Masaje', categoryId, price: 50000 })).json<{ id: string; kind: string }>();
    expect(shampoo).toMatchObject({ kind: 'product', kindConfirmed: false });
    expect(masaje.kind).toBe('service');

    const pending = (await send(biz.session, 'GET', '/api/items/classification')).json<ClassificationEntry[]>();
    expect(pending.map((e) => e.name).sort()).toEqual(['Masaje', 'Shampoo']); // "Corte" ya se creó con kind explícito → confirmado
    expect(pending.find((e) => e.name === 'Shampoo')).toMatchObject({ suggestedKind: 'product', kind: 'product', stock: 5 });

    // El dueño decide que el shampoo en realidad es un servicio de 20 minutos.
    const confirm = await send(biz.session, 'POST', '/api/items/classification', { entries: [{ itemId: shampoo.id, kind: 'service', durationMinutes: 20 }, { itemId: masaje.id, kind: 'service' }] });
    expect(confirm.json()).toEqual({ confirmed: 2 });
    expect((await send(biz.session, 'GET', '/api/items/classification')).json()).toEqual([]);
    expect((await send(biz.session, 'GET', '/api/items/classification?all=1')).json<ClassificationEntry[]>().find((e) => e.id === shampoo.id)).toMatchObject({ kind: 'service', durationMinutes: 20 });
    expect((await app.inject({ method: 'GET', url: `${biz.base}/catalog` })).json<{ services: Array<{ name: string }> }>().services.map((s) => s.name).sort()).toEqual(['Corte', 'Masaje', 'Shampoo']);

    expect((await send(biz.session, 'POST', '/api/items/classification', { entries: [{ itemId: shampoo.id, kind: 'product' }, { itemId: shampoo.id, kind: 'service' }] })).statusCode).toBe(400); // repetido
    const other = await setupBiz(app, 'Revision ajena');
    expect((await send(other.session, 'POST', '/api/items/classification', { entries: [{ itemId: shampoo.id, kind: 'product' }] })).statusCode).toBe(404);
    expect((await send(biz.session, 'GET', '/api/items/classification?all=1')).json<ClassificationEntry[]>().find((e) => e.id === shampoo.id)!.kind).toBe('service');
  });

  it('las apps ya instaladas (sin campos nuevos) siguen creando y editando artículos igual que antes', async () => {
    const biz = await register(app, 'Compat');
    const categoryId = (await send(biz, 'GET', '/api/categories')).json<Array<{ id: string }>>()[0]!.id;
    const created = await send(biz, 'POST', '/api/items', { name: 'Crema', categoryId, price: 12000, stock: 2, internalUnitCost: 5000 });
    expect(created.statusCode).toBe(201);
    const item = created.json<{ id: string; durationMinutes: number; bookable: boolean }>();
    expect(item).toMatchObject({ durationMinutes: 30, bookable: true });
    const edited = await send(biz, 'PUT', `/api/items/${item.id}`, { name: 'Crema facial', categoryId, price: 13000, stock: 2, internalUnitCost: 5000 });
    expect(edited.json()).toMatchObject({ name: 'Crema facial', kind: 'product', durationMinutes: 30 });
  });
});

describe('dirección de la página y contenido', () => {
  it('cambiar la dirección: reservadas y ocupadas se rechazan, la anterior redirige y nadie más puede tomarla', async () => {
    const a = await setupBiz(app, 'Direccion A');
    const b = await setupBiz(app, 'Direccion B');
    const oldSlug = a.slug;
    const check = (session: Biz['session'], slug: string) => send(session, 'GET', `/api/booking/slug/check?slug=${encodeURIComponent(slug)}`).then((r) => r.json<{ available: boolean; reason?: string }>());

    expect(await check(a.session, 'admin')).toMatchObject({ available: false, reason: 'slug_reserved' });
    expect(await check(a.session, 'Con Espacios')).toMatchObject({ available: false });
    expect(await check(a.session, 'ab')).toMatchObject({ available: false, reason: 'slug_invalid' });
    expect(await check(a.session, b.slug)).toMatchObject({ available: false, reason: 'slug_taken' });
    expect((await send(a.session, 'PUT', '/api/booking/slug', { slug: b.slug })).json()).toMatchObject({ code: 'slug_taken' });
    expect((await send(a.session, 'PUT', '/api/booking/slug', { slug: 'reservar' })).statusCode).toBe(400);

    const newSlug = `nuevo-${oldSlug}`.slice(0, 40).replace(/-+$/, '');
    expect((await send(a.session, 'PUT', '/api/booking/slug', { slug: newSlug })).json()).toEqual({ slug: newSlug });
    expect((await app.inject({ method: 'GET', url: `/api/public/booking/${newSlug}` })).json<PublicBookingProfile>().slug).toBe(newSlug);
    // La dirección anterior sigue funcionando y apunta a la vigente.
    expect((await app.inject({ method: 'GET', url: `/api/public/booking/${oldSlug}` })).json<PublicBookingProfile>().slug).toBe(newSlug);
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/${oldSlug}` })).statusCode).toBe(200);
    // Nadie más puede reclamar la anterior.
    expect((await send(b.session, 'PUT', '/api/booking/slug', { slug: oldSlug })).json()).toMatchObject({ code: 'slug_taken' });
    expect(await check(b.session, oldSlug)).toMatchObject({ available: false, reason: 'slug_taken' });
    // Su dueño puede volver a ella.
    expect((await send(a.session, 'PUT', '/api/booking/slug', { slug: oldSlug })).json()).toEqual({ slug: oldSlug });
    expect((await app.inject({ method: 'GET', url: `/api/public/booking/${newSlug}` })).json<PublicBookingProfile>().slug).toBe(oldSlug);
  });

  it('perfil: se guarda parcialmente, valida enlaces y coordenadas, y oculta secciones desactivadas', async () => {
    const biz = await setupBiz(app, 'Perfil');
    const saved = await send(biz.session, 'PUT', '/api/booking/profile', { tagline: 'Cortes con estilo', instagram: 'https://instagram.com/xiro', latitude: 4.65, longitude: -74.05, sections: { reviews: false } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<BookingAdminSettings>().profile).toMatchObject({ tagline: 'Cortes con estilo', published: true, sections: { reviews: false, services: true } });
    expect((await send(biz.session, 'PUT', '/api/booking/profile', { instagram: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await send(biz.session, 'PUT', '/api/booking/profile', { latitude: 4.65 })).statusCode).toBe(400); // las coordenadas van juntas
    expect((await send(biz.session, 'PUT', '/api/booking/profile', { latitude: 200, longitude: 0 })).statusCode).toBe(400);
    const profile = (await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>();
    expect(profile).toMatchObject({ tagline: 'Cortes con estilo', latitude: 4.65, sections: { reviews: false } });
    expect(profile.rating).toEqual({ average: null, count: 0 });
    await send(biz.session, 'PUT', '/api/booking/profile', { sections: { map: false } });
    expect((await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>()).toMatchObject({ latitude: null, longitude: null });
  });

  it('portada y galería: solo imágenes reales, con límite', async () => {
    const biz = await setupBiz(app, 'Fotos');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    const form = async (file: Buffer) => {
      const data = new FormData();
      data.append('photo', new Blob([new Uint8Array(file)], { type: 'image/png' }), 'foto.png');
      const response = new Response(data);
      return { payload: Buffer.from(await response.arrayBuffer()), headers: { ...auth(biz.session), 'content-type': response.headers.get('content-type')! } };
    };
    const bad = await form(Buffer.from('esto no es una imagen, solo texto largo'));
    expect((await app.inject({ method: 'PUT', url: '/api/booking/profile/cover', ...bad })).statusCode).toBe(400);
    const cover = await app.inject({ method: 'PUT', url: '/api/booking/profile/cover', ...(await form(png)) });
    expect(cover.statusCode).toBe(200);
    expect(cover.json<BookingAdminSettings>().profile.coverUrl).toMatch(/^\/media\/.+\.png$/);
    expect((await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>().coverUrl).toMatch(/^\/media\//);
    for (let i = 0; i < 8; i += 1) expect((await app.inject({ method: 'POST', url: '/api/booking/profile/gallery', ...(await form(png)) })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/booking/profile/gallery', ...(await form(png)) })).statusCode).toBe(400);
    const settings = (await send(biz.session, 'GET', '/api/booking/settings')).json<BookingAdminSettings>();
    expect(settings.profile.gallery).toHaveLength(8);
    expect((await send(biz.session, 'DELETE', `/api/booking/profile/gallery/${settings.profile.gallery[0]!.file}`)).json<BookingAdminSettings>().profile.gallery).toHaveLength(7);
    expect((await send(biz.session, 'DELETE', '/api/booking/profile/gallery/no-existe.png')).statusCode).toBe(404);
  });

  it('reseñas: solo las aprobadas se ven en la página y cuentan en la calificación', async () => {
    const biz = await setupBiz(app, 'Resenas');
    const other = await setupBiz(app, 'Resenas ajenas');
    const date = workday(4);
    await book(app, biz, date, '10:00');
    await book(app, other, date, '10:00');
    const [mine] = await testDb.db.select().from(appointments).where(eq(appointments.businessId, biz.session.business.id));
    const [theirs] = await testDb.db.select().from(appointments).where(eq(appointments.businessId, other.session.business.id));
    const [review] = await testDb.db.insert(reviews).values({ businessId: biz.session.business.id, appointmentId: mine!.id, rating: 5, comment: 'Excelente', authorName: 'María P.' }).returning();
    const [foreign] = await testDb.db.insert(reviews).values({ businessId: other.session.business.id, appointmentId: theirs!.id, rating: 1, comment: 'Malo', authorName: 'Otro O.', status: 'approved' }).returning();

    const publicReviews = () => app.inject({ method: 'GET', url: `${biz.base}/reviews` }).then((r) => r.json<PublicReviewDto[]>());
    expect(await publicReviews()).toEqual([]); // pendiente de moderación
    expect((await send(biz.session, 'GET', '/api/booking/reviews?status=pending')).json()).toHaveLength(1);
    expect((await send(biz.session, 'PATCH', `/api/booking/reviews/${foreign!.id}`, { status: 'approved' })).statusCode).toBe(404); // de otro negocio
    expect((await send(biz.session, 'PATCH', `/api/booking/reviews/${review!.id}`, { status: 'approved' })).json()).toMatchObject({ status: 'approved' });
    expect(await publicReviews()).toEqual([expect.objectContaining({ rating: 5, authorName: 'María P.' })]);
    expect(JSON.stringify(await publicReviews())).not.toMatch(/appointment|client|phone/i);
    expect((await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>().rating).toEqual({ average: 5, count: 1 });
    await send(biz.session, 'PATCH', `/api/booking/reviews/${review!.id}`, { status: 'hidden' });
    expect(await publicReviews()).toEqual([]);
    expect((await send(biz.session, 'GET', '/api/booking/reviews')).json()).toHaveLength(1); // el dueño la sigue viendo
  });
});

describe('completar una cita cierra el ciclo con caja, inventario y fidelización', () => {
  it('cobra cada línea, suma el sello, descuenta el producto y no se puede repetir', async () => {
    const biz = await setupBiz(app, 'Cierre');
    const cera = await createService(app, biz.session, { name: 'Cera', price: 20000, kind: 'product', stock: 3, internalUnitCost: 8000 });
    expect((await send(biz.session, 'PUT', '/api/loyalty/program', { enabled: true, goal: 1, itemIds: [biz.serviceId] })).statusCode).toBe(200);
    const date = workday(4);
    const created = await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:00', { selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [{ itemId: cera.id, quantity: 2 }] } }));
    expect(created.statusCode).toBe(201);
    const appt = created.json<AppointmentDto>();
    expect(appt.totalPrice).toBe(30000 + 40000);
    expect(appt.items.map((i) => i.kind).sort()).toEqual(['product', 'service']);

    const done = await send(biz.session, 'POST', `/api/appointments/${appt.id}/status`, { status: 'completed' });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ status: 'completed', rewardJustEarned: true });

    const records = (await send(biz.session, 'GET', `/api/service-records?clientId=${appt.client.id}`)).json<Array<{ label: string; amount: number; loyaltyCounted: boolean }>>();
    expect(records.map((r) => [r.label, r.amount, r.loyaltyCounted]).sort()).toEqual([['Cera ×2', 40000, false], ['Corte', 30000, true]].sort());
    const item = (await send(biz.session, 'GET', `/api/items/${cera.id}`)).json<{ stock: number; stockStatus: string }>();
    expect(item).toMatchObject({ stock: 1, stockStatus: 'reorder' });
    const progress = (await send(biz.session, 'GET', '/api/loyalty/clients')).json<Array<{ clientId: string; count: number }>>();
    expect(progress.find((p) => p.clientId === appt.client.id)?.count).toBe(1);

    // No se cobra dos veces.
    expect((await send(biz.session, 'POST', `/api/appointments/${appt.id}/status`, { status: 'completed' })).statusCode).toBe(409);
    expect((await send(biz.session, 'GET', `/api/service-records?clientId=${appt.client.id}`)).json()).toHaveLength(2);
  });

  it('un empleado con permiso completa SU cita; una cita cancelada o de otro no cobra nada', async () => {
    const { biz, luis } = await withLuis(['appointments_manage']);
    const date = workday(4);
    const own = (await send(luis.session, 'POST', '/api/appointments', staffBody(biz, luis.employee.id, date, '10:00'))).json<AppointmentDto>();
    const other = (await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '12:00'))).json<AppointmentDto>();
    expect((await send(luis.session, 'POST', `/api/appointments/${other.id}/status`, { status: 'completed' })).statusCode).toBe(404);
    expect((await send(luis.session, 'POST', `/api/appointments/${own.id}/status`, { status: 'completed' })).statusCode).toBe(200);
    const cancelled = (await send(biz.session, 'POST', `/api/appointments/${other.id}/status`, { status: 'cancelled' })).json<AppointmentDto>();
    expect(cancelled.status).toBe('cancelled');
    expect((await send(biz.session, 'GET', `/api/service-records?clientId=${other.client.id}`)).json()).toEqual([]);
    expect((await send(biz.session, 'GET', `/api/service-records?clientId=${own.client.id}`)).json()).toHaveLength(1);
  });

  it('un producto sin existencias suficientes no se puede apartar', async () => {
    const biz = await setupBiz(app, 'Sin stock');
    const cera = await createService(app, biz.session, { name: 'Cera', price: 20000, kind: 'product', stock: 1 });
    const res = await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, workday(4), '10:00', { selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [{ itemId: cera.id, quantity: 2 }] } }));
    expect(res.json()).toMatchObject({ code: 'item_not_bookable' });
  });
});

describe('mover una cita: la disponibilidad ignora la propia cita', () => {
  it('con excludeAppointmentId su propio horario aparece libre; la página pública nunca lo usa', async () => {
    const biz = await setupBiz(app, 'Excluir');
    const date = workday(4);
    const appt = (await send(biz.session, 'POST', '/api/appointments', staffBody(biz, biz.ownerId, date, '10:00'))).json<AppointmentDto>();
    const slots = async (extra: string) => (await send(biz.session, 'GET', `/api/booking/availability?date=${date}&services=${biz.serviceId}${extra}`)).json<{ slots: Array<{ time: string; state: string }> }>().slots;
    expect(stateAt(await slots(''), '10:30')).toBe('booked');
    expect(stateAt(await slots(`&excludeAppointmentId=${appt.id}`), '10:30')).toBe('available');
    expect(stateAt(await slots(`&excludeAppointmentId=${appt.id}`), '10:00')).toBe('available');
    // Público: el parámetro no tiene efecto (no se puede "ver" un horario ajeno como libre).
    expect(stateAt((await availability(app, biz, date, `&excludeAppointmentId=${appt.id}`)).body.slots, '10:30')).toBe('booked');
    // Y moverla 30 minutos, solapándose consigo misma, funciona.
    expect((await send(biz.session, 'PATCH', `/api/appointments/${appt.id}`, { startsAt: at(date, '10:30') })).json<AppointmentDto>().startsAt).toBe(at(date, '10:30'));
  });
});
