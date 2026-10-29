import type { Item, Page, ProductOrderDto, PublicBookingProfile, PublicProductOrderDto } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { withBusiness } from '../src/booking/scope';
import { items, productOrders } from '../src/db/schema';
import { auth, book, createEmployee, createService, nextPhone, register, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 1 del plan: pedidos de SOLO productos desde la página pública (recoger y pagar en el local), sin romper las citas.
 * Casos obligatorios: solo servicio, solo producto, producto + servicio, agotado, doble clic, negocio sin productos o sin
 * servicios — y aislamiento entre negocios en cada paso.
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

const enableOrders = async (biz: Biz, on = true) => expect((await app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload: { productOrdersEnabled: on } })).statusCode).toBe(200);
const product = (biz: Biz, over: Record<string, unknown> = {}) => createService(app, biz.session, { name: 'Shampoo', price: 15000, kind: 'product', stock: 5, ...over });
const customer = (over: Record<string, unknown> = {}) => ({ firstName: 'Ana', lastName: 'Pérez', phone: nextPhone(), email: '', notes: '', custom: {}, ...over });
const order = (biz: Biz, products: Array<{ itemId: string; quantity: number }>, over: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `${biz.base}/orders`, payload: { products, customer: customer(), acceptTerms: true, website: '', ...over } });
const profileOf = async (biz: Biz) => (await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>();
const stockOf = async (itemId: string) => (await testDb.db.select({ stock: items.stock }).from(items).where(eq(items.id, itemId)))[0]!.stock;

describe('pedido de solo productos: activación por negocio', () => {
  it('apagado por defecto: el perfil no lo ofrece y el servidor lo rechaza (aunque llamen la API a mano)', async () => {
    const biz = await setupBiz(app, 'Sin pedidos');
    const shampoo = await product(biz);
    expect((await profileOf(biz)).acceptsProductOrders).toBe(false);
    const res = await order(biz, [{ itemId: shampoo.id, quantity: 1 }]);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'orders_disabled' });
  });

  it('activado: el perfil lo ofrece solo si hay algún producto con existencias, y el panel ve el interruptor', async () => {
    const biz = await setupBiz(app, 'Con pedidos');
    await enableOrders(biz);
    expect((await profileOf(biz)).acceptsProductOrders).toBe(false); // aún sin productos
    await product(biz, { stock: 0 });
    expect((await profileOf(biz)).acceptsProductOrders).toBe(false); // solo agotados
    await product(biz, { name: 'Cera', stock: 2 });
    expect((await profileOf(biz)).acceptsProductOrders).toBe(true);
    const settings = (await app.inject({ method: 'GET', url: '/api/booking/settings', headers: auth(biz.session) })).json<{ settings: { productOrdersEnabled: boolean } }>();
    expect(settings.settings.productOrdersEnabled).toBe(true);
  });
});

describe('pedido de solo productos: crear', () => {
  it('caso B: solo productos → 201 sin profesional ni hora; precios y total los pone el servidor; el inventario NO se toca aún', async () => {
    const biz = await setupBiz(app, 'Solo productos B');
    await enableOrders(biz);
    const shampoo = await product(biz, { price: 15000, stock: 5 });
    const cera = await product(biz, { name: 'Cera', price: 22000, stock: 3 });
    const res = await order(biz, [
      { itemId: shampoo.id, quantity: 2 },
      { itemId: cera.id, quantity: 1 },
    ]);
    expect(res.statusCode).toBe(201);
    const { order: created } = res.json<{ order: PublicProductOrderDto }>();
    expect(created).toMatchObject({ status: 'pending', totalPrice: 52000, business: { slug: biz.slug, currency: 'COP' } });
    expect(created.items.map((i) => [i.name, i.unitPrice, i.quantity]).sort()).toEqual([
      ['Cera', 22000, 1],
      ['Shampoo', 15000, 2],
    ]);
    expect(await stockOf(shampoo.id)).toBe(5);
    expect(JSON.stringify(created)).not.toMatch(/internalUnitCost|stock|customerPhone|clientId/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('producto agotado o sin existencias suficientes → 409 out_of_stock con CUÁL (nunca cuántas unidades quedan)', async () => {
    const biz = await setupBiz(app, 'Agotado');
    await enableOrders(biz);
    const shampoo = await product(biz, { stock: 1 });
    const res = await order(biz, [{ itemId: shampoo.id, quantity: 2 }]);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(expect.objectContaining({ code: 'out_of_stock', itemIds: [shampoo.id] }));
    expect(res.body).not.toContain('"stock"');
  });

  it('producto de OTRO negocio, oculto, un servicio o inexistente → 409 product_unavailable (no se cuela en el pedido)', async () => {
    const mine = await setupBiz(app, 'Mío');
    const other = await setupBiz(app, 'Ajeno');
    await enableOrders(mine);
    await product(mine);
    const foreign = await product(other);
    const hidden = await product(mine, { name: 'Oculto', published: false });
    for (const itemId of [foreign.id, hidden.id, mine.serviceId, '00000000-0000-4000-8000-000000000000']) {
      const res = await order(mine, [{ itemId, quantity: 1 }]);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'product_unavailable' });
    }
  });

  it('validaciones: sin productos, cantidades fuera de rango, mismo producto repetido, sin términos o campo trampa → 400', async () => {
    const biz = await setupBiz(app, 'Validaciones');
    await enableOrders(biz);
    const shampoo = await product(biz);
    expect((await order(biz, [])).statusCode).toBe(400);
    expect((await order(biz, [{ itemId: shampoo.id, quantity: 0 }])).statusCode).toBe(400);
    expect((await order(biz, [{ itemId: shampoo.id, quantity: 21 }])).statusCode).toBe(400);
    expect((await order(biz, [{ itemId: shampoo.id, quantity: 1 }, { itemId: shampoo.id, quantity: 1 }])).statusCode).toBe(400);
    expect((await order(biz, [{ itemId: shampoo.id, quantity: 1 }], { acceptTerms: false })).statusCode).toBe(400);
    expect((await order(biz, [{ itemId: shampoo.id, quantity: 1 }], { website: 'http://spam' })).statusCode).toBe(400);
    expect((await order(biz, [{ itemId: shampoo.id, quantity: 1 }], { customer: customer({ phone: '123' }) })).statusCode).toBe(400);
  });

  it('doble clic: 8 envíos simultáneos con la misma clave crean UN solo pedido y todos reciben el mismo', async () => {
    const biz = await setupBiz(app, 'Doble clic');
    await enableOrders(biz);
    const shampoo = await product(biz);
    const payload = { products: [{ itemId: shampoo.id, quantity: 1 }], customer: customer(), acceptTerms: true, website: '', idempotencyKey: '6f1e3d0a-4b7c-4e2a-9f8d-1a2b3c4d5e6f' };
    const results = await Promise.all(Array.from({ length: 8 }, () => app.inject({ method: 'POST', url: `${biz.base}/orders`, payload })));
    expect(results.every((r) => [200, 201].includes(r.statusCode))).toBe(true);
    expect(new Set(results.map((r) => r.json<{ order: PublicProductOrderDto }>().order.id)).size).toBe(1);
    const rows = await testDb.db.select({ id: productOrders.id }).from(productOrders).where(eq(productOrders.businessId, biz.session.business.id));
    expect(rows).toHaveLength(1);
  });

  it('un mismo cliente no puede acumular más pedidos abiertos que el máximo del negocio (anti-abuso)', async () => {
    const biz = await setupBiz(app, 'Máximo abiertos');
    await enableOrders(biz);
    const shampoo = await product(biz, { stock: 50 });
    const phone = nextPhone();
    for (let i = 0; i < 3; i += 1) expect((await order(biz, [{ itemId: shampoo.id, quantity: 1 }], { customer: customer({ phone }) })).statusCode).toBe(201);
    const extra = await order(biz, [{ itemId: shampoo.id, quantity: 1 }], { customer: customer({ phone }) });
    expect(extra.statusCode).toBe(429);
    expect(extra.json()).toMatchObject({ code: 'too_many_pending' });
  });

  it('el pedido queda en la ficha del cliente (por su celular) sin duplicar clientes', async () => {
    const biz = await setupBiz(app, 'Ficha');
    await enableOrders(biz);
    const shampoo = await product(biz, { stock: 10 });
    const phone = nextPhone();
    await order(biz, [{ itemId: shampoo.id, quantity: 1 }], { customer: customer({ phone }) });
    await order(biz, [{ itemId: shampoo.id, quantity: 1 }], { customer: customer({ phone }) });
    const list = (await app.inject({ method: 'GET', url: '/api/orders', headers: auth(biz.session) })).json<Page<ProductOrderDto>>();
    expect(list.data).toHaveLength(2);
    expect(new Set(list.data.map((o) => o.clientId)).size).toBe(1);
  });
});

describe('las citas siguen igual (casos A y C)', () => {
  it('caso A: solo servicio → la reserva funciona exactamente como antes', async () => {
    const biz = await setupBiz(app, 'Caso A');
    await enableOrders(biz);
    expect((await book(app, biz, workday(3), '10:00')).statusCode).toBe(201);
  });

  it('caso C: servicio + productos → una cita que incluye los productos para llevar (no un pedido aparte)', async () => {
    const biz = await setupBiz(app, 'Caso C');
    await enableOrders(biz);
    const shampoo = await product(biz);
    const res = await book(app, biz, workday(3), '11:00', { selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [{ itemId: shampoo.id, quantity: 2 }] } });
    expect(res.statusCode).toBe(201);
    const items = res.json<{ appointment: { items: Array<{ kind: string; quantity: number }> } }>().appointment.items;
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'product', quantity: 2 })]));
    const orders = await testDb.db.select({ id: productOrders.id }).from(productOrders).where(eq(productOrders.businessId, biz.session.business.id));
    expect(orders).toHaveLength(0);
  });

  it('una reserva de cita sin servicio sigue rechazándose (el contrato de citas no cambió)', async () => {
    const biz = await setupBiz(app, 'Cita sin servicio');
    const shampoo = await product(biz);
    const res = await book(app, biz, workday(3), '12:00', { selection: { services: [], packages: [], products: [{ itemId: shampoo.id, quantity: 1 }] } });
    expect(res.statusCode).toBe(400);
  });
});

describe('panel del negocio: atender pedidos', () => {
  async function bizWithOrder(label: string) {
    const biz = await setupBiz(app, label);
    await enableOrders(biz);
    const shampoo = await product(biz, { price: 15000, stock: 5 });
    const created = (await order(biz, [{ itemId: shampoo.id, quantity: 2 }])).json<{ order: PublicProductOrderDto }>().order;
    return { biz, shampoo, orderId: created.id };
  }
  const sale = (biz: Biz, itemId: string, orderId: string, quantity = 2, amount = 30000) =>
    app.inject({ method: 'POST', url: '/api/sales', headers: auth(biz.session), payload: { occasional: true, lines: [{ kind: 'product', itemId, quantity }], payments: [{ method: 'cash', amount }], productOrderId: orderId } });

  it('lista (más recientes primero), filtra por estado y cuenta los pendientes', async () => {
    const { biz, orderId } = await bizWithOrder('Lista');
    const list = (await app.inject({ method: 'GET', url: '/api/orders?status=open', headers: auth(biz.session) })).json<Page<ProductOrderDto>>();
    expect(list.data.map((o) => o.id)).toEqual([orderId]);
    expect(list.data[0]).toMatchObject({ status: 'pending', totalPrice: 30000, customerName: 'Ana Pérez', saleId: null });
    expect((await app.inject({ method: 'GET', url: '/api/orders/summary', headers: auth(biz.session) })).json()).toEqual({ pending: 1, ready: 0 });
    expect((await app.inject({ method: 'GET', url: '/api/orders?status=delivered', headers: auth(biz.session) })).json<Page<ProductOrderDto>>().data).toEqual([]);
  });

  it('pendiente → listo → entregado con una venta: descuenta el inventario UNA vez y enlaza la venta', async () => {
    const { biz, shampoo, orderId } = await bizWithOrder('Entregar');
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/ready`, headers: auth(biz.session) })).json()).toMatchObject({ status: 'ready' });
    const res = await sale(biz, shampoo.id, orderId);
    expect(res.statusCode).toBe(201);
    expect(await stockOf(shampoo.id)).toBe(3);
    const after = (await app.inject({ method: 'GET', url: `/api/orders/${orderId}`, headers: auth(biz.session) })).json<ProductOrderDto>();
    expect(after).toMatchObject({ status: 'delivered', saleId: res.json<{ id: string }>().id });
    // Una segunda venta para el MISMO pedido se rechaza entera: el inventario no vuelve a bajar.
    const again = await sale(biz, shampoo.id, orderId);
    expect(again.statusCode).toBe(409);
    expect(await stockOf(shampoo.id)).toBe(3);
  });

  it('dos ventas simultáneas para el mismo pedido: solo una gana y el inventario baja una sola vez', async () => {
    const { biz, shampoo, orderId } = await bizWithOrder('Entrega simultánea');
    const results = await Promise.all(Array.from({ length: 6 }, () => sale(biz, shampoo.id, orderId)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(5);
    expect(await stockOf(shampoo.id)).toBe(3);
  });

  it('cancelar guarda el motivo; un pedido cerrado no cambia más (transiciones inválidas → 409)', async () => {
    const { biz, shampoo, orderId } = await bizWithOrder('Cancelar');
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/cancel`, headers: auth(biz.session), payload: { reason: 'No vino' } })).json()).toMatchObject({ status: 'cancelled', cancelReason: 'No vino' });
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/ready`, headers: auth(biz.session) })).statusCode).toBe(409);
    expect((await sale(biz, shampoo.id, orderId)).statusCode).toBe(409);
    expect(await stockOf(shampoo.id)).toBe(5);
  });

  it('aislamiento: otro negocio no ve, no cuenta, no cambia ni entrega mis pedidos (404), ni con la base directa (RLS)', async () => {
    const { biz, orderId } = await bizWithOrder('Privado');
    const intruder = await setupBiz(app, 'Intruso');
    const intruderProduct = await product(intruder);
    expect((await app.inject({ method: 'GET', url: '/api/orders', headers: auth(intruder.session) })).json<Page<ProductOrderDto>>().data).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/orders/summary', headers: auth(intruder.session) })).json()).toEqual({ pending: 0, ready: 0 });
    for (const url of [`/api/orders/${orderId}`]) expect((await app.inject({ method: 'GET', url, headers: auth(intruder.session) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/ready`, headers: auth(intruder.session) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/cancel`, headers: auth(intruder.session) })).statusCode).toBe(404);
    expect((await sale(intruder, intruderProduct.id, orderId, 1, 15000)).statusCode).toBe(404);
    const seen = await withBusiness(testDb.db, intruder.session.business.id, (tx) => tx.select({ id: productOrders.id }).from(productOrders).where(eq(productOrders.id, orderId)));
    expect(seen).toEqual([]);
    // El pedido sigue intacto para su dueño.
    expect((await app.inject({ method: 'GET', url: `/api/orders/${orderId}`, headers: auth(biz.session) })).json()).toMatchObject({ status: 'pending' });
  });

  it('permisos: un empleado sin "registrar servicios" no ve pedidos (403); con el permiso, sí', async () => {
    const { biz } = await bizWithOrder('Permisos');
    const without = await createEmployee(app, biz.session, ['clients_view']);
    const withPermission = await createEmployee(app, biz.session, ['services_record']);
    expect((await app.inject({ method: 'GET', url: '/api/orders', headers: auth(without.session) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/orders', headers: auth(withPermission.session) })).statusCode).toBe(200);
  });
});

describe('tres negocios distintos (solo servicios, solo productos, ambos)', () => {
  it('cada uno ofrece exactamente lo que tiene', async () => {
    // Solo servicios: reservas sí, pedidos no (aunque los active, no tiene productos).
    const services = await setupBiz(app, 'Solo servicios');
    await enableOrders(services);
    expect(await profileOf(services)).toMatchObject({ acceptsBookings: true, acceptsProductOrders: false });

    // Solo productos: sin servicio reservable no hay citas, pero sí pedidos.
    const session = await register(app, 'Solo productos');
    const onlyProducts: Biz = { session, slug: session.business.slug, ownerId: session.user.id, serviceId: '', base: `/api/public/booking/${session.business.slug}` };
    expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(session), payload: { published: true } })).statusCode).toBe(200);
    await enableOrders(onlyProducts);
    const item: Item = await createService(app, session, { name: 'Perfume', price: 80000, kind: 'product', stock: 4 });
    expect(await profileOf(onlyProducts)).toMatchObject({ acceptsBookings: false, acceptsProductOrders: true });
    expect((await order(onlyProducts, [{ itemId: item.id, quantity: 1 }])).statusCode).toBe(201);

    // Ambos.
    const both = await setupBiz(app, 'Ambos');
    await enableOrders(both);
    await product(both);
    expect(await profileOf(both)).toMatchObject({ acceptsBookings: true, acceptsProductOrders: true });
  });
});
