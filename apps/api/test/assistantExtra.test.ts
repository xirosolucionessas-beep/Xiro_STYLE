import type { AssistantAnswer } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { serviceRecords } from '../src/db/schema';
import { at, auth, type Biz, createEmployee, nextPhone, register, setupBiz, workday } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Asistente de negocio — Fase C: citas y clientes (nuevas funciones de agregación, ver apps/api/src/assistant/extraData.ts).
 * Igual disciplina que assistantRoutes.test.ts (Fase A): mismo permiso y mismo recorte "solo mi agenda" que ya exige
 * su pantalla equivalente (GET /appointments, GET /clients).
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

const ask = (session: { accessToken: string }, question: string, extra: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/api/assistant/ask?${new URLSearchParams({ question, ...extra })}`, headers: auth(session) });

const staffAppointment = (biz: Biz, professionalId: string, date: string, time: string) => ({
  professionalId,
  startsAt: at(date, time),
  selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [] },
  newClient: { name: 'Cliente de cita', phone: nextPhone() },
});

async function createClient(session: { accessToken: string }, name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name, phone: nextPhone() } });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

async function sellTo(session: { accessToken: string }, biz: Biz, clientId: string | undefined, price: number, employeeId?: string) {
  const payload: Record<string, unknown> = { lines: [{ kind: 'service', itemId: biz.serviceId, unitPrice: price, employeeId: employeeId ?? null }], payments: [{ method: 'cash', amount: price }] };
  if (clientId) payload.clientId = clientId;
  else payload.occasional = true;
  const res = await app.inject({ method: 'POST', url: '/api/sales', headers: auth(session), payload });
  expect(res.statusCode).toBe(201);
}

describe('citas: appointments_by_status y appointments_by_professional respetan "solo mi agenda" (agenda_own)', () => {
  it('sin "ver todas las agendas", cada empleado solo ve sus propias citas; el dueño las ve todas', async () => {
    const biz = await setupBiz(app, 'Citas asistente');
    const luis = await createEmployee(app, biz.session, ['agenda_own']);
    const maria = await createEmployee(app, biz.session, ['agenda_all']);
    expect((await app.inject({ method: 'PATCH', url: `/api/professionals/${luis.employee.id}`, headers: auth(biz.session), payload: { bookable: true, publicName: 'Luis' } })).statusCode).toBe(200);

    const date = workday(1);
    expect((await app.inject({ method: 'POST', url: '/api/appointments', headers: auth(biz.session), payload: staffAppointment(biz, biz.ownerId, date, '10:00') })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/appointments', headers: auth(biz.session), payload: staffAppointment(biz, luis.employee.id, date, '14:00') })).statusCode).toBe(201);

    const ownerStatus = (await ask(biz.session, 'appointments_by_status', { period: 'month' })).json<AssistantAnswer>();
    expect((ownerStatus.data as { rows: Array<{ count: number }> }).rows.reduce((n, r) => n + r.count, 0)).toBe(2);

    const luisStatus = (await ask(luis.session, 'appointments_by_status', { period: 'month' })).json<AssistantAnswer>();
    expect((luisStatus.data as { rows: Array<{ count: number }> }).rows.reduce((n, r) => n + r.count, 0)).toBe(1);

    const luisByPro = (await ask(luis.session, 'appointments_by_professional', { period: 'month' })).json<AssistantAnswer>();
    expect((luisByPro.data as { rows: Array<{ professionalName: string }> }).rows).toHaveLength(1);

    const mariaByPro = (await ask(maria.session, 'appointments_by_professional', { period: 'month' })).json<AssistantAnswer>();
    expect((mariaByPro.data as { rows: unknown[] }).rows).toHaveLength(2);
  });
});

describe('citas: appointments_upcoming', () => {
  it('solo las que ocupan la agenda (no una cancelada), desde ahora, y recortadas a la propia sin "ver todas"', async () => {
    const biz = await setupBiz(app, 'Próximas citas');
    const luis = await createEmployee(app, biz.session, ['agenda_own']);
    expect((await app.inject({ method: 'PATCH', url: `/api/professionals/${luis.employee.id}`, headers: auth(biz.session), payload: { bookable: true, publicName: 'Luis' } })).statusCode).toBe(200);

    const date = workday(2);
    expect((await app.inject({ method: 'POST', url: '/api/appointments', headers: auth(biz.session), payload: staffAppointment(biz, biz.ownerId, date, '09:00') })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/appointments', headers: auth(biz.session), payload: staffAppointment(biz, luis.employee.id, date, '11:00') })).statusCode).toBe(201);
    const cancelled = (await app.inject({ method: 'POST', url: '/api/appointments', headers: auth(biz.session), payload: staffAppointment(biz, luis.employee.id, date, '16:00') })).json<{ id: string }>();
    expect((await app.inject({ method: 'POST', url: `/api/appointments/${cancelled.id}/status`, headers: auth(biz.session), payload: { status: 'cancelled', reason: 'no vino' } })).statusCode).toBe(200);

    const ownerUpcoming = (await ask(biz.session, 'appointments_upcoming')).json<AssistantAnswer>();
    const ownerRows = (ownerUpcoming.data as { rows: Array<{ clientName: string }> }).rows;
    expect(ownerRows).toHaveLength(2); // ni forOwner ni forLuis están cancelados; la 3ra sí.
    expect(ownerUpcoming.period).toBeNull();

    const luisUpcoming = (await ask(luis.session, 'appointments_upcoming')).json<AssistantAnswer>();
    const luisRows = (luisUpcoming.data as { rows: Array<{ clientName: string }> }).rows;
    expect(luisRows).toHaveLength(1); // solo la suya; la cancelada no cuenta igual.
  });
});

describe('clientes: clients_new excluye siempre al cliente "de mostrador"', () => {
  it('cuenta solo clientes con ficha creados en el período', async () => {
    const owner = await register(app, 'Clientes nuevos');
    await createClient(owner, 'Ana');
    await createClient(owner, 'Beto');
    // Una venta ocasional crea (o reutiliza) el cliente "de mostrador" — nunca debe contar como nuevo.
    const biz = await setupBiz(app, 'Clientes nuevos biz');
    await sellTo(biz.session, biz, undefined, 10_000);

    const res = (await ask(owner, 'clients_new', { period: 'today' })).json<AssistantAnswer>();
    expect(res.data).toMatchObject({ count: 2 });
  });
});

describe('clientes: clients_served cuenta clientes DISTINTOS con ficha y servicio no anulado', () => {
  it('un cliente ocasional no cuenta como atendido; dos ventas al mismo cliente cuentan como 1', async () => {
    const biz = await setupBiz(app, 'Clientes atendidos');
    const clientId = await createClient(biz.session, 'Carla');
    await sellTo(biz.session, biz, clientId, 20_000);
    await sellTo(biz.session, biz, clientId, 15_000); // misma clienta, segunda venta
    await sellTo(biz.session, biz, undefined, 5_000); // cliente ocasional: no debe sumar

    const res = (await ask(biz.session, 'clients_served', { period: 'today' })).json<AssistantAnswer>();
    expect(res.data).toMatchObject({ count: 1 });
  });
});

describe('clientes: clients_not_returning', () => {
  it('solo clientes con AL MENOS una visita, cuya última visita fue hace más del umbral fijo', async () => {
    const biz = await setupBiz(app, 'Clientes inactivos');
    const stale = await createClient(biz.session, 'Daniela');
    const recent = await createClient(biz.session, 'Elena');
    await createClient(biz.session, 'Fabián'); // nunca ha tenido una visita: no debe aparecer

    await sellTo(biz.session, biz, stale, 30_000);
    await sellTo(biz.session, biz, recent, 30_000);
    // Retrocede la visita de Daniela más de 30 días (umbral fijo — ver CLIENTS_NOT_RETURNING_THRESHOLD_DAYS).
    await testDb.db.update(serviceRecords).set({ createdAt: new Date(Date.now() - 40 * 24 * 3_600_000) }).where(eq(serviceRecords.clientId, stale));

    const res = (await ask(biz.session, 'clients_not_returning')).json<AssistantAnswer>();
    const data = res.data as { thresholdDays: number; rows: Array<{ name: string }> };
    expect(data.thresholdDays).toBe(30);
    expect(data.rows.map((r) => r.name)).toEqual(['Daniela']);
  });
});

describe('ventas: top_employees reutiliza el mismo reporte que top_services (sin consulta nueva)', () => {
  it('ordena a los empleados por monto vendido, de mayor a menor', async () => {
    const biz = await setupBiz(app, 'Top empleados');
    const luis = await createEmployee(app, biz.session, ['services_record']);
    await sellTo(biz.session, biz, undefined, 20_000, luis.employee.id);
    await sellTo(biz.session, biz, undefined, 50_000, biz.session.user.id);

    const res = (await ask(biz.session, 'top_employees', { period: 'today' })).json<AssistantAnswer>();
    const rows = (res.data as { rows: Array<{ employeeName: string; total: number }> }).rows;
    expect(rows[0]).toMatchObject({ total: 50_000 });
    expect(rows[1]).toMatchObject({ total: 20_000 });
  });
});
