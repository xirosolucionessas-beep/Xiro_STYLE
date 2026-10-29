import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AuthSession } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteOwnBusiness } from '../src/accountDeletion';
import { buildApp } from '../src/app';
import type { Ctx } from '../src/context';
import { appointments, businesses, clients, expenses, itemPhotos, items, platformAuditLog, sales, users } from '../src/db/schema';
import type { AdminAlertMessage, Notifier } from '../src/notifier';
import { at, auth, book, createEmployee, firstCategoryId, nextPhone, register, setupBiz, workday } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';
import { photoForm, realJpeg } from './helpers/media';

/**
 * Cambio de la propia contraseña (POST /me/password) y eliminación definitiva del negocio (DELETE /business) — ver la
 * propuesta de este encargo. La eliminación es la pieza de más riesgo: se comprueba con datos REALES que tocan las
 * relaciones más delicadas del esquema (citas, ventas, gastos — todas con FKs compuestas hacia `users` sin cascada
 * propia; solo funciona porque Postgres resuelve todo el borrado del negocio como UNA sola cascada), no solo con una
 * fila vacía.
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
let mediaDir: string;
const adminAlerts = vi.fn<(message: AdminAlertMessage) => Promise<void>>().mockResolvedValue(undefined);

const testNotifier: Notifier = {
  sendOtp: async () => undefined,
  sendAppointmentReminder: async () => undefined,
  sendAdminAlert: adminAlerts,
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  mediaDir = config.mediaDir!;
  app = await buildApp({ db: testDb.db, config, notifier: testNotifier });
});
afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const PASSWORD = 'Secreta123';

describe('POST /me/password — cambio de la propia contraseña', () => {
  it('contraseña actual incorrecta: 400, nunca cambia nada', async () => {
    const owner = await register(app, 'Cambio contraseña 1');
    const res = await app.inject({ method: 'POST', url: '/api/me/password', headers: auth(owner), payload: { currentPassword: 'Incorrecta123', newPassword: 'NuevaClave456' } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('invalid_current_password');
  });

  it('contraseña nueva igual a la actual: rechazada con un código propio', async () => {
    const owner = await register(app, 'Cambio contraseña 2');
    const res = await app.inject({ method: 'POST', url: '/api/me/password', headers: auth(owner), payload: { currentPassword: PASSWORD, newPassword: PASSWORD } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('password_same_as_current');
  });

  it('contraseña nueva débil (sin mayúscula/número, o muy corta): 400 de validación', async () => {
    const owner = await register(app, 'Cambio contraseña 3');
    const weak = await app.inject({ method: 'POST', url: '/api/me/password', headers: auth(owner), payload: { currentPassword: PASSWORD, newPassword: 'corta1' } });
    expect(weak.statusCode).toBe(400);
    const noDigit = await app.inject({ method: 'POST', url: '/api/me/password', headers: auth(owner), payload: { currentPassword: PASSWORD, newPassword: 'SinNumeros' } });
    expect(noDigit.statusCode).toBe(400);
  });

  it('un empleado puede cambiar SU PROPIA contraseña, y después solo entra con la nueva', async () => {
    const owner = await register(app, 'Cambio contraseña 4');
    const created = await createEmployee(app, owner, []);
    const res = await app.inject({ method: 'POST', url: '/api/me/password', headers: auth(created.session), payload: { currentPassword: PASSWORD, newPassword: 'ClaveNueva789' } });
    expect(res.statusCode).toBe(200);

    const oldLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: created.employee.email, password: PASSWORD } });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: created.employee.email, password: 'ClaveNueva789' } });
    expect(newLogin.statusCode).toBe(200);
  });
});

describe('DELETE /business — permisos (solo el dueño, igual en la interfaz y en el backend)', () => {
  it('un empleado nunca puede eliminar el negocio, aunque mande la contraseña correcta del dueño', async () => {
    const owner = await register(app, 'Permiso borrado 1');
    const employee = (await createEmployee(app, owner, [])).session;
    const res = await app.inject({ method: 'DELETE', url: '/api/business', headers: auth(employee), payload: { password: PASSWORD } });
    expect(res.statusCode).toBe(403);
    const [stillThere] = await testDb.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, owner.business.id));
    expect(stillThere).toBeTruthy();
  });

  it('contraseña incorrecta: 400, el negocio no se toca', async () => {
    const owner = await register(app, 'Permiso borrado 2');
    const res = await app.inject({ method: 'DELETE', url: '/api/business', headers: auth(owner), payload: { password: 'Incorrecta123' } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('invalid_current_password');
    const [stillThere] = await testDb.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, owner.business.id));
    expect(stillThere).toBeTruthy();
  });
});

describe('DELETE /business — eliminación transaccional real, con relaciones que importan', () => {
  it('borra TODO lo del negocio (citas, ventas, gastos, clientes, fotos), nunca lo de otro negocio, y avisa a XIRO', async () => {
    const other = await register(app, 'Vecino que sobrevive');
    const otherItem = await app.inject({ method: 'POST', url: '/api/items', headers: auth(other), payload: { name: 'Servicio del vecino', categoryId: await firstCategoryId(app, other), price: 10_000, kind: 'service', durationMinutes: 30 } });
    expect(otherItem.statusCode).toBe(201);

    const biz = await setupBiz(app, 'Negocio a eliminar');
    const owner = biz.session;

    // Cita real (ocupa la agenda del dueño como profesional).
    const date = workday(1);
    const booked = await book(app, biz, date, '10:00');
    expect(booked.statusCode).toBe(201);

    // Venta con empleado asignado a la línea (ejercita sales.createdBy y sale_items.employeeId).
    const saleRes = await app.inject({ method: 'POST', url: '/api/sales', headers: auth(owner), payload: { lines: [{ kind: 'service', itemId: biz.serviceId, employeeId: biz.ownerId }], payments: [{ method: 'cash', amount: 30_000 }] } });
    expect(saleRes.statusCode).toBe(201);

    // Gasto (ejercita expenses.createdBy).
    const expenseRes = await app.inject({ method: 'POST', url: '/api/expenses', headers: auth(owner), payload: { amount: 15_000, description: 'Arriendo', method: 'cash', type: 'operating', category: 'rent' } });
    expect(expenseRes.statusCode).toBe(201);

    // Cliente con foto + ítem con foto (ejercita la limpieza de archivos de medios).
    const clientRes = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(owner), payload: { name: 'Clienta con foto', phone: nextPhone() } });
    expect(clientRes.statusCode).toBe(201);
    const clientId = clientRes.json<{ id: string }>().id;
    const photo = await photoForm(await realJpeg());
    const clientPhotoRes = await app.inject({ method: 'PUT', url: `/api/clients/${clientId}/photo`, headers: { ...auth(owner), 'content-type': photo.contentType }, payload: photo.payload });
    expect(clientPhotoRes.statusCode).toBe(200);
    const clientPhotoFile = clientPhotoRes.json<{ photoUrl: string }>().photoUrl.split('/').pop()!;
    const itemPhotoRes = await app.inject({ method: 'POST', url: `/api/items/${biz.serviceId}/photos`, headers: { ...auth(owner), 'content-type': photo.contentType }, payload: photo.payload });
    expect(itemPhotoRes.statusCode).toBe(201);
    expect(existsSync(path.join(mediaDir, clientPhotoFile))).toBe(true);

    adminAlerts.mockClear();
    const del = await app.inject({ method: 'DELETE', url: '/api/business', headers: auth(owner), payload: { password: PASSWORD } });
    expect(del.statusCode).toBe(200);
    expect(del.json<{ ok: boolean }>().ok).toBe(true);

    // El negocio y TODO lo suyo desapareció de verdad (nunca solo "marcado").
    const businessId = owner.business.id;
    expect((await testDb.db.select().from(businesses).where(eq(businesses.id, businessId))).length).toBe(0);
    expect((await testDb.db.select().from(users).where(eq(users.businessId, businessId))).length).toBe(0);
    expect((await testDb.db.select().from(appointments).where(eq(appointments.businessId, businessId))).length).toBe(0);
    expect((await testDb.db.select().from(sales).where(eq(sales.businessId, businessId))).length).toBe(0);
    expect((await testDb.db.select().from(expenses).where(eq(expenses.businessId, businessId))).length).toBe(0);
    expect((await testDb.db.select().from(clients).where(eq(clients.businessId, businessId))).length).toBe(0);
    expect((await testDb.db.select().from(items).where(eq(items.businessId, businessId))).length).toBe(0);
    expect((await testDb.db.select().from(itemPhotos).where(eq(itemPhotos.itemId, biz.serviceId))).length).toBe(0);

    // El vecino nunca se tocó.
    const [neighbor] = await testDb.db.select().from(items).where(eq(items.businessId, other.business.id));
    expect(neighbor?.name).toBe('Servicio del vecino');

    // Los archivos de medios se limpiaron de verdad (no solo la fila en la base).
    expect(existsSync(path.join(mediaDir, clientPhotoFile))).toBe(false);

    // Auditoría: sobrevive aunque el negocio ya no exista, con quién lo pidió y qué negocio era.
    const [auditRow] = await testDb.db.select().from(platformAuditLog).where(eq(platformAuditLog.action, 'business.self_delete'));
    expect(auditRow).toMatchObject({ businessId, outcome: 'success', adminId: null });
    expect(auditRow!.details).toMatchObject({ businessName: owner.business.name, requestedByUserId: biz.ownerId, requestedByRole: 'owner' });

    // Avisó a XIRO (número oficial), sin credenciales de nadie en el mensaje.
    expect(adminAlerts).toHaveBeenCalledTimes(1);
    const alert = adminAlerts.mock.calls[0]![0];
    expect(alert).toMatchObject({ to: '573013059562', event: 'business_self_deleted', businessId });

    // La sesión ya no sirve: el usuario (y su negocio) no existen más.
    const after = await app.inject({ method: 'GET', url: '/api/me', headers: auth(owner) });
    expect([401, 404]).toContain(after.statusCode);
  });
});

describe('DELETE /business — un intento fallido también queda en la auditoría', () => {
  it('si la eliminación en sí falla, se registra un intento "error" por separado (la transacción ya se revirtió)', async () => {
    const fakeCtx = { db: testDb.db, media: { get: async () => null, put: async () => undefined, exists: async () => false, remove: async () => undefined, kind: 'local' as const }, notifier: testNotifier } as unknown as Ctx;
    const bogusBusinessId = '00000000-0000-4000-8000-000000000000';
    const fakeRequest = { id: 'req-test-1', ip: '127.0.0.1', log: { error: () => undefined } } as unknown as Parameters<typeof deleteOwnBusiness>[1];

    await expect(deleteOwnBusiness(fakeCtx, fakeRequest, bogusBusinessId, { id: 'u1', name: 'Dueño Fantasma', email: 'fantasma@correo.com', role: 'owner' }, 'Negocio Inexistente')).rejects.toThrow();

    const [errorRow] = await testDb.db.select().from(platformAuditLog).where(eq(platformAuditLog.businessId, bogusBusinessId));
    expect(errorRow).toMatchObject({ action: 'business.self_delete', outcome: 'error' });
    expect(errorRow!.details).toMatchObject({ businessName: 'Negocio Inexistente', requestedByName: 'Dueño Fantasma' });
  });
});
