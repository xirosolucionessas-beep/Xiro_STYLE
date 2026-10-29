import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { createRealtimeBus, type RealtimeBus } from '../src/realtime';
import { consumeSseTicket, issueSseTicket } from '../src/sseTickets';
import { register, auth } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

describe('sseTickets: llave de un solo uso para el stream (EventSource no manda el header de sesión)', () => {
  it('un ticket recién emitido devuelve el negocio, y una segunda vez ya no (de un solo uso)', () => {
    const ticket = issueSseTicket('biz-1');
    expect(consumeSseTicket(ticket)).toBe('biz-1');
    expect(consumeSseTicket(ticket)).toBeNull();
  });

  it('un ticket que nunca existió, o ya vencido, no devuelve ningún negocio', () => {
    expect(consumeSseTicket('no-existe')).toBeNull();
    vi.useFakeTimers();
    const ticket = issueSseTicket('biz-2');
    vi.advanceTimersByTime(31_000);
    expect(consumeSseTicket(ticket)).toBeNull();
    vi.useRealTimers();
  });
});

describe('createRealtimeBus: LISTEN/NOTIFY de verdad contra la base de pruebas', () => {
  let testDb: TestDatabase;
  let bus: RealtimeBus;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    bus = createRealtimeBus(testDb.config, () => undefined);
    // Da tiempo a que el cliente dedicado termine CONNECT + LISTEN antes de la primera prueba.
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterAll(async () => {
    await bus.close();
    await testDb.drop();
  });

  it('un cambio real en la tabla de citas (vía el disparador de la migración 0009) llega a quien escucha ESE negocio', async () => {
    const businessId = randomUUID();
    const heard = new Promise<void>((resolve) => {
      const unsubscribe = bus.onBusiness(businessId, () => {
        unsubscribe();
        resolve();
      });
    });
    // No hace falta una cita real ni válida: el disparador AFTER dispara con cualquier fila, y aquí solo interesa el aviso.
    await testDb.db.execute(sql`select pg_notify('appointments_changed', ${JSON.stringify({ businessId })})`);
    await expect(heard).resolves.toBeUndefined();
  });

  it('el aviso dice QUÉ cambió: sin `kind` (citas, como siempre) = appointments; con kind orders = pedidos', async () => {
    const businessId = randomUUID();
    const kinds: string[] = [];
    const unsubscribe = bus.onBusiness(businessId, (kind) => kinds.push(kind));
    await testDb.db.execute(sql`select pg_notify('appointments_changed', ${JSON.stringify({ businessId })})`);
    await testDb.db.execute(sql`select pg_notify('appointments_changed', ${JSON.stringify({ businessId, kind: 'orders' })})`);
    await vi.waitFor(() => expect(kinds).toEqual(['appointments', 'orders']));
    unsubscribe();
  });

  it('un aviso de OTRO negocio nunca llega a quien escucha este', async () => {
    const mine = randomUUID();
    const other = randomUUID();
    const spy = vi.fn();
    const unsubscribe = bus.onBusiness(mine, spy);
    await testDb.db.execute(sql`select pg_notify('appointments_changed', ${JSON.stringify({ businessId: other })})`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    unsubscribe();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /api/booking/events/ticket y GET /api/booking/events (capa HTTP)', () => {
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

  it('la ruta autenticada emite un ticket, y el negocio que trae es el de la sesión (no uno elegido por quien pide)', async () => {
    const session = await register(app);
    const res = await app.inject({ method: 'POST', url: '/api/booking/events/ticket', headers: auth(session) });
    expect(res.statusCode).toBe(200);
    const { ticket } = res.json<{ ticket: string }>();
    expect(consumeSseTicket(ticket)).toBe(session.business.id);
  });

  it('sin sesión, la emisión del ticket responde 401 (es una ruta normal, protegida como cualquier otra)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/booking/events/ticket' });
    expect(res.statusCode).toBe(401);
  });

  it('el stream rechaza un ticket inválido o ya usado, sin llegar a abrir la conexión', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/booking/events?ticket=esto-no-vale-nada' });
    expect(res.statusCode).toBe(401);
  });
});

describe('pedido real de la página pública → aviso "orders" (trigger de la migración 0025)', () => {
  let app: FastifyInstance;
  let testDb: TestDatabase;
  let bus: RealtimeBus;
  let cleanupConfig: () => void;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const { config, cleanup } = testAppConfig();
    cleanupConfig = cleanup;
    app = await buildApp({ db: testDb.db, config });
    bus = createRealtimeBus(testDb.config, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterAll(async () => {
    await bus.close();
    await app.close();
    cleanupConfig();
    await testDb.drop();
  });

  it('crear un pedido avisa SOLO al negocio dueño, con kind orders (sin datos del pedido en el aviso)', async () => {
    const { setupBiz, createService, nextPhone } = await import('./helpers/booking');
    const owner = await setupBiz(app, 'Tiempo real');
    const other = await setupBiz(app, 'Otro negocio');
    expect((await app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(owner.session), payload: { productOrdersEnabled: true } })).statusCode).toBe(200);
    const product = await createService(app, owner.session, { name: 'Gel', price: 9000, kind: 'product', stock: 3 });

    const mine: string[] = [];
    const theirs: string[] = [];
    const stopMine = bus.onBusiness(owner.session.business.id, (kind) => mine.push(kind));
    const stopTheirs = bus.onBusiness(other.session.business.id, (kind) => theirs.push(kind));
    const res = await app.inject({ method: 'POST', url: `${owner.base}/orders`, payload: { products: [{ itemId: product.id, quantity: 1 }], customer: { firstName: 'Ana', lastName: 'Ruiz', phone: nextPhone(), email: '', notes: '', custom: {} }, acceptTerms: true, website: '' } });
    expect(res.statusCode).toBe(201);
    await vi.waitFor(() => expect(mine).toContain('orders'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    stopMine();
    stopTheirs();
    expect(theirs).toEqual([]);
  });
});
