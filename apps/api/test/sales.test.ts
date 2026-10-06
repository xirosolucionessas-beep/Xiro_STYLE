import type { AuthSession, Item, SaleDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, createEmployee, createService, firstCategoryId, register } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

let testDb: TestDatabase;
let app: FastifyInstance;
let cleanup: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const setup = testAppConfig();
  cleanup = setup.cleanup;
  app = await buildApp({ db: testDb.db, config: setup.config });
});
afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

const send = (session: { accessToken: string }, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, headers: auth(session), payload: payload as object | undefined });

const createSale = (session: { accessToken: string }, payload: unknown) => send(session, 'POST', '/api/sales', payload);
const getSale = (session: { accessToken: string }, id: string) => send(session, 'GET', `/api/sales/${id}`).then((r) => r.json<SaleDto>());
const voidSale = (session: { accessToken: string }, id: string, reason: string) => send(session, 'POST', `/api/sales/${id}/void`, { reason });
const listSales = (session: { accessToken: string }, from: string, to: string) => send(session, 'GET', `/api/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then((r) => r.json<SaleDto[]>());
const getItem = (session: { accessToken: string }, id: string) => send(session, 'GET', `/api/items/${id}`).then((r) => r.json<Item>());

async function createProduct(session: AuthSession, over: Record<string, unknown> = {}): Promise<Item> {
  const res = await send(session, 'POST', '/api/items', { name: 'Shampoo', categoryId: await firstCategoryId(app, session), price: 20000, kind: 'product', stock: 5, ...over });
  expect(res.statusCode).toBe(201);
  return res.json<Item>();
}

async function createClient(session: AuthSession, name = 'Cliente Fijo'): Promise<{ id: string }> {
  const res = await send(session, 'POST', '/api/clients', { name });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>();
}

const todayRange = () => {
  const from = new Date(Date.now() - 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  return { from, to };
};

describe('registrar una venta', () => {
  it('un servicio de catálogo se cobra al precio del catálogo y queda en "ventas de hoy"', async () => {
    const owner = await register(app, 'POS');
    const service = await createService(app, owner);
    const client = await createClient(owner);
    const res = await createSale(owner, { clientId: client.id, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: service.price }] });
    expect(res.statusCode).toBe(201);
    const sale = res.json<SaleDto>();
    expect(sale.total).toBe(service.price);
    expect(sale.items).toEqual([expect.objectContaining({ itemId: service.id, name: 'Corte', unitPrice: service.price, quantity: 1 })]);
    expect(sale.clientId).toBe(client.id);

    const { from, to } = todayRange();
    const today = await listSales(owner, from, to);
    expect(today.map((s) => s.id)).toContain(sale.id);
  });

  it('un producto de catálogo descuenta existencias de forma atómica y avisa si no alcanza', async () => {
    const owner = await register(app, 'Stock');
    const product = await createProduct(owner, { stock: 3 });
    const ok = await createSale(owner, { occasional: true, lines: [{ kind: 'product', itemId: product.id, quantity: 2 }], payments: [{ method: 'cash', amount: product.price * 2 }] });
    expect(ok.statusCode).toBe(201);
    expect((await getItem(owner, product.id)).stock).toBe(1);

    const short = await createSale(owner, { occasional: true, lines: [{ kind: 'product', itemId: product.id, quantity: 2 }], payments: [{ method: 'cash', amount: product.price * 2 }] });
    expect(short.statusCode).toBe(409);
    expect(short.json<{ code: string }>().code).toBe('insufficient_stock');
    expect((await getItem(owner, product.id)).stock).toBe(1); // sin cambios: la venta rechazada no se aplica a medias
  });

  it('una línea a mano no toca el catálogo, salvo que se pida guardarla', async () => {
    const owner = await register(app, 'Manual');
    const res = await createSale(owner, {
      occasional: true,
      lines: [{ kind: 'service', name: 'Peinado especial', unitPrice: 45000, quantity: 1 }],
      payments: [{ method: 'cash', amount: 45000 }],
    });
    expect(res.statusCode).toBe(201);
    const sale = res.json<SaleDto>();
    expect(sale.items[0]).toMatchObject({ itemId: null, name: 'Peinado especial', unitPrice: 45000 });

    const items = await send(owner, 'GET', '/api/items').then((r) => r.json<Item[]>());
    expect(items.some((i) => i.name === 'Peinado especial')).toBe(false);

    const saved = await createSale(owner, {
      occasional: true,
      lines: [{ kind: 'service', name: 'Peinado con guardado', unitPrice: 50000, quantity: 1, saveToCatalog: true }],
      payments: [{ method: 'cash', amount: 50000 }],
    });
    expect(saved.statusCode).toBe(201);
    const itemsAfter = await send(owner, 'GET', '/api/items').then((r) => r.json<Item[]>());
    expect(itemsAfter.some((i) => i.name === 'Peinado con guardado' && i.price === 50000)).toBe(true);
  });

  it('el ajuste de precio de una venta puntual exige el permiso de catálogo y no toca el precio guardado', async () => {
    const owner = await register(app, 'Descuento');
    const service = await createService(app, owner, { price: 30000 });
    const cashier = await createEmployee(app, owner, ['services_record']);
    const manager = await createEmployee(app, owner, ['services_record', 'catalog_manage']);

    const denied = await createSale(cashier.session, { occasional: true, lines: [{ kind: 'service', itemId: service.id, unitPrice: 20000, quantity: 1 }], payments: [{ method: 'cash', amount: 20000 }] });
    expect(denied.statusCode).toBe(403);

    const allowed = await createSale(manager.session, { occasional: true, lines: [{ kind: 'service', itemId: service.id, unitPrice: 20000, quantity: 1 }], payments: [{ method: 'cash', amount: 20000 }] });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json<SaleDto>().items[0]!.unitPrice).toBe(20000);
    expect((await getItem(owner, service.id)).price).toBe(30000); // el catálogo no cambió
  });

  it('admite pagos partidos y calcula el cambio en efectivo', async () => {
    const owner = await register(app, 'Split');
    const service = await createService(app, owner, { price: 50000 });
    const res = await createSale(owner, {
      occasional: true,
      lines: [{ kind: 'service', itemId: service.id, quantity: 1 }],
      tip: 5000,
      payments: [
        { method: 'cash', amount: 25000, receivedAmount: 30000 },
        { method: 'nequi', amount: 30000 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const sale = res.json<SaleDto>();
    expect(sale.total).toBe(55000);
    expect(sale.changeGiven).toBe(5000);
    expect(sale.payments).toHaveLength(2);
  });

  it('si los pagos no suman el total, se rechaza', async () => {
    const owner = await register(app, 'Descuadre');
    const service = await createService(app, owner, { price: 50000 });
    const res = await createSale(owner, { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 10000 }] });
    expect(res.statusCode).toBe(400);
  });

  it('cliente ocasional: comparte una sola ficha por negocio y nunca aparece en el directorio', async () => {
    const owner = await register(app, 'Ocasional');
    const service = await createService(app, owner, { price: 10000 });
    const a = await createSale(owner, { occasional: true, clientLabel: 'Alguien', lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 10000 }] });
    const b = await createSale(owner, { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 10000 }] });
    expect(a.json<SaleDto>().clientName).toBe('Alguien');
    expect(b.json<SaleDto>().clientName).toBe('Cliente ocasional');
    const directory = await send(owner, 'GET', '/api/clients').then((r) => r.json<Array<{ name: string }>>());
    expect(directory.some((c) => c.name === 'Cliente ocasional')).toBe(false);
  });
});

describe('anular una venta', () => {
  it('repone el stock, exige motivo y no se puede anular dos veces', async () => {
    const owner = await register(app, 'Anular');
    const product = await createProduct(owner, { stock: 5 });
    const created = await createSale(owner, { occasional: true, lines: [{ kind: 'product', itemId: product.id, quantity: 2 }], payments: [{ method: 'cash', amount: product.price * 2 }] });
    const sale = created.json<SaleDto>();
    expect((await getItem(owner, product.id)).stock).toBe(3);

    expect((await voidSale(owner, sale.id, '')).statusCode).toBe(400); // motivo obligatorio
    const voided = await voidSale(owner, sale.id, 'Cliente se arrepintió');
    expect(voided.statusCode).toBe(200);
    expect(voided.json<SaleDto>().status).toBe('voided');
    expect((await getItem(owner, product.id)).stock).toBe(5); // repuesto

    expect((await voidSale(owner, sale.id, 'Otra vez')).statusCode).toBe(409);
  });

  it('solo el dueño puede anular', async () => {
    const owner = await register(app, 'SoloDueno');
    const service = await createService(app, owner, { price: 10000 });
    const created = await createSale(owner, { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 10000 }] });
    const cashier = await createEmployee(app, owner, ['services_record']);
    expect((await voidSale(cashier.session, created.json<SaleDto>().id, 'motivo')).statusCode).toBe(403);
  });
});

describe('aislamiento entre negocios e historial congelado', () => {
  it('un negocio no puede ver, ni anular, la venta de otro', async () => {
    const a = await register(app, 'NegocioA');
    const service = await createService(app, a, { price: 15000 });
    const created = await createSale(a, { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 15000 }] });
    const sale = created.json<SaleDto>();

    const b = await register(app, 'NegocioB');
    expect((await send(b, 'GET', `/api/sales/${sale.id}`)).statusCode).toBe(404);
    expect((await voidSale(b, sale.id, 'ajeno')).statusCode).toBe(404);
  });

  it('editar el precio o nombre del catálogo después no cambia una venta ya registrada', async () => {
    const owner = await register(app, 'Historial');
    const service = await createService(app, owner, { price: 40000 });
    const created = await createSale(owner, { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 40000 }] });
    const saleId = created.json<SaleDto>().id;

    await send(owner, 'PUT', `/api/items/${service.id}`, { name: 'Corte Premium', categoryId: service.categoryId, price: 60000, kind: 'service', durationMinutes: 60 });

    const sale = await getSale(owner, saleId);
    expect(sale.items[0]).toMatchObject({ name: 'Corte', unitPrice: 40000 });
  });
});
