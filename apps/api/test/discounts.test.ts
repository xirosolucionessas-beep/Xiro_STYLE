import type { AppointmentDto, DiscountCodeDto, PublicBookingResult, PublicDiscountDto, PublicProductOrderDto } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { appointments, discountCodes, serviceRecords } from '../src/db/schema';
import { auth, book, createService, nextPhone, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Fase 4 del plan: códigos de descuento — validados y contados en el servidor, por negocio. */
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

const settings = (biz: Biz, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload });
const createCode = (biz: Biz, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/discount-codes', headers: auth(biz.session), payload });
const check = (biz: Biz, code: string) => app.inject({ method: 'GET', url: `${biz.base}/discount?code=${encodeURIComponent(code)}` });
const usesOf = async (code: string, biz: Biz) => (await testDb.db.select({ uses: discountCodes.uses }).from(discountCodes).where(eq(discountCodes.code, code))).find(Boolean)?.uses ?? (void biz, -1);

async function bizWithCodes(label: string) {
  const biz = await setupBiz(app, label); // servicio "Corte" de $30.000
  expect((await settings(biz, { discountCodesEnabled: true, productOrdersEnabled: true })).statusCode).toBe(200);
  return biz;
}

describe('códigos de descuento: activación y validación', () => {
  it('apagados por defecto: el código no se valida ni se puede usar al reservar (409 genérico)', async () => {
    const biz = await setupBiz(app, 'Sin códigos');
    expect((await createCode(biz, { code: 'HOLA10', kind: 'percent', value: 10 })).statusCode).toBe(201);
    expect((await check(biz, 'HOLA10')).json()).toMatchObject({ code: 'discount_invalid' });
    const res = await book(app, biz, workday(3), '10:00', { discountCode: 'HOLA10' });
    expect(res.statusCode).toBe(409);
  });

  it('vista previa: devuelve lo justo para mostrar (sin usos ni límites internos); mayúsculas/minúsculas da igual', async () => {
    const biz = await bizWithCodes('Vista previa');
    await createCode(biz, { code: 'verano10', description: '10% en servicios', kind: 'percent', value: 10, maxUses: 50 });
    const res = await check(biz, 'Verano10');
    expect(res.statusCode).toBe(200);
    expect(res.json<PublicDiscountDto>()).toEqual({ code: 'VERANO10', description: '10% en servicios', kind: 'percent', value: 10, minTotal: 0 });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('inexistente, inactivo, vencido, aún no vigente o de OTRO negocio: la misma respuesta (no se puede averiguar nada)', async () => {
    const biz = await bizWithCodes('Inválidos');
    const other = await bizWithCodes('Otro negocio códigos');
    await createCode(biz, { code: 'APAGADO', kind: 'percent', value: 10, active: false });
    await createCode(biz, { code: 'VENCIDO', kind: 'percent', value: 10, endsAt: new Date(Date.now() - 86_400_000).toISOString() });
    await createCode(biz, { code: 'FUTURO', kind: 'percent', value: 10, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    await createCode(other, { code: 'AJENO', kind: 'percent', value: 10 });
    for (const code of ['NOEXISTE', 'APAGADO', 'VENCIDO', 'FUTURO', 'AJENO']) {
      const res = await check(biz, code);
      expect(res.statusCode, code).toBe(409);
      expect(res.json(), code).toMatchObject({ code: 'discount_invalid' });
    }
    expect((await check(biz, '<script>')).statusCode).toBe(400);
  });
});

describe('códigos de descuento: al reservar', () => {
  it('porcentaje: la cita guarda el descuento (total bruto intacto), cuenta un uso y el cliente lo ve en su confirmación', async () => {
    const biz = await bizWithCodes('Porcentaje');
    await createCode(biz, { code: 'DIEZ', kind: 'percent', value: 10 });
    const res = await book(app, biz, workday(3), '09:00', { discountCode: 'diez' });
    expect(res.statusCode).toBe(201);
    expect(res.json<PublicBookingResult>().appointment).toMatchObject({ totalPrice: 30000, discount: { code: 'DIEZ', amount: 3000 } });
    expect(await usesOf('DIEZ', biz)).toBe(1);
    // El personal también lo ve en la agenda.
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 40 * 86_400_000).toISOString();
    const list = (await app.inject({ method: 'GET', url: `/api/appointments?from=${from}&to=${to}`, headers: auth(biz.session) })).json<AppointmentDto[]>();
    expect(list.find((a) => a.discount)?.discount).toEqual({ code: 'DIEZ', amount: 3000 });
    // Al completarla, el ingreso registrado es lo que se cobró (total menos el descuento), no el precio de lista.
    const id = list.find((a) => a.discount)!.id;
    expect((await app.inject({ method: 'POST', url: `/api/appointments/${id}/status`, headers: auth(biz.session), payload: { status: 'completed' } })).statusCode).toBe(200);
    const records = await testDb.db.select({ amount: serviceRecords.amount }).from(serviceRecords).where(eq(serviceRecords.businessId, biz.session.business.id));
    expect(records.reduce((sum, r) => sum + r.amount, 0)).toBe(27000);
  });

  it('monto fijo mayor que el total: descuenta como mucho el total (nunca un total negativo)', async () => {
    const biz = await bizWithCodes('Fijo');
    await createCode(biz, { code: 'REGALO', kind: 'fixed', value: 999999 });
    const res = await book(app, biz, workday(3), '11:00', { discountCode: 'REGALO' });
    expect(res.json<PublicBookingResult>().appointment.discount).toEqual({ code: 'REGALO', amount: 30000 });
  });

  it('sin llegar al mínimo: 409 con el mínimo y la reserva NO se crea (ni cuenta un uso)', async () => {
    const biz = await bizWithCodes('Mínimo');
    await createCode(biz, { code: 'MINIMO', kind: 'percent', value: 20, minTotal: 50000 });
    const res = await book(app, biz, workday(3), '12:00', { discountCode: 'MINIMO' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'discount_min_total', minTotal: 50000 });
    expect(await testDb.db.select({ id: appointments.id }).from(appointments).where(eq(appointments.businessId, biz.session.business.id))).toHaveLength(0);
    expect(await usesOf('MINIMO', biz)).toBe(0);
  });

  it('último uso disponible y 5 reservas a la vez: solo UNA lo obtiene; las demás se revierten enteras', async () => {
    const biz = await bizWithCodes('Último uso');
    await createCode(biz, { code: 'UNICO', kind: 'percent', value: 50, maxUses: 1 });
    const times = ['09:00', '10:00', '11:00', '14:00', '15:00'];
    const results = await Promise.all(times.map((time) => book(app, biz, workday(4), time, { discountCode: 'UNICO' })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json<{ code: string }>().code === 'discount_invalid')).toBe(true);
    expect(await usesOf('UNICO', biz)).toBe(1);
    expect(await testDb.db.select({ id: appointments.id }).from(appointments).where(eq(appointments.businessId, biz.session.business.id))).toHaveLength(1);
  });

  it('"una vez por cliente": el mismo celular no lo usa dos veces (otro cliente sí)', async () => {
    const biz = await bizWithCodes('Una vez');
    await createCode(biz, { code: 'BIENVENIDA', kind: 'percent', value: 15, oncePerClient: true });
    const phone = nextPhone();
    const customer = (p: string) => ({ firstName: 'Ana', lastName: 'Ruiz', email: '', phone: p, notes: '', custom: {} });
    expect((await book(app, biz, workday(5), '09:00', { discountCode: 'BIENVENIDA', customer: customer(phone) })).statusCode).toBe(201);
    const again = await book(app, biz, workday(5), '11:00', { discountCode: 'BIENVENIDA', customer: customer(phone) });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'discount_already_used' });
    expect((await book(app, biz, workday(5), '14:00', { discountCode: 'BIENVENIDA', customer: customer(nextPhone()) })).statusCode).toBe(201);
  });

  it('pedido de solo productos: el descuento se calcula sobre el total de los productos', async () => {
    const biz = await bizWithCodes('Pedido con código');
    const product = await createService(app, biz.session, { name: 'Gel', price: 20000, kind: 'product', stock: 5 });
    await createCode(biz, { code: 'PROD5', kind: 'fixed', value: 5000 });
    const res = await app.inject({ method: 'POST', url: `${biz.base}/orders`, payload: { products: [{ itemId: product.id, quantity: 2 }], customer: { firstName: 'Ana', lastName: 'Ruiz', phone: nextPhone(), email: '', notes: '', custom: {} }, acceptTerms: true, website: '', discountCode: 'prod5' } });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ order: PublicProductOrderDto }>().order).toMatchObject({ totalPrice: 40000, discount: { code: 'PROD5', amount: 5000 } });
  });
});

describe('códigos de descuento: panel del negocio', () => {
  it('crea (normaliza el código), lista, edita y borra; un código repetido o un porcentaje > 100 se rechazan', async () => {
    const biz = await bizWithCodes('Panel códigos');
    const created = await createCode(biz, { code: 'navidad', kind: 'percent', value: 25, description: 'Navidad' });
    expect(created.statusCode).toBe(201);
    const code = created.json<DiscountCodeDto>();
    expect(code).toMatchObject({ code: 'NAVIDAD', uses: 0, active: true });
    expect((await createCode(biz, { code: 'NAVIDAD', kind: 'fixed', value: 1000 })).json()).toMatchObject({ code: 'discount_code_exists' });
    expect((await createCode(biz, { code: 'MUCHO', kind: 'percent', value: 150 })).statusCode).toBe(400);
    expect((await createCode(biz, { code: 'a', kind: 'percent', value: 5 })).statusCode).toBe(400);
    const updated = await app.inject({ method: 'PUT', url: `/api/discount-codes/${code.id}`, headers: auth(biz.session), payload: { code: 'NAVIDAD', kind: 'percent', value: 30, active: false } });
    expect(updated.json<DiscountCodeDto>()).toMatchObject({ value: 30, active: false });
    expect((await app.inject({ method: 'GET', url: '/api/discount-codes', headers: auth(biz.session) })).json<DiscountCodeDto[]>().map((c) => c.code)).toEqual(['NAVIDAD']);
    expect((await app.inject({ method: 'DELETE', url: `/api/discount-codes/${code.id}`, headers: auth(biz.session) })).statusCode).toBe(204);
  });

  it('aislamiento: otro negocio no ve, no edita ni borra mis códigos (404)', async () => {
    const mine = await bizWithCodes('Mis códigos');
    const intruder = await bizWithCodes('Intruso códigos');
    const code = (await createCode(mine, { code: 'PRIVADO', kind: 'percent', value: 10 })).json<DiscountCodeDto>();
    expect((await app.inject({ method: 'GET', url: '/api/discount-codes', headers: auth(intruder.session) })).json()).toEqual([]);
    expect((await app.inject({ method: 'PUT', url: `/api/discount-codes/${code.id}`, headers: auth(intruder.session), payload: { code: 'PRIVADO', kind: 'percent', value: 99 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/discount-codes/${code.id}`, headers: auth(intruder.session) })).statusCode).toBe(404);
    expect((await check(mine, 'PRIVADO')).json<PublicDiscountDto>().value).toBe(10);
  });
});
