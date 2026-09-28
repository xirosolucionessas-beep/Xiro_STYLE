import type { AuthSession, Employee, EmployeePermission, Item } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { addDays, localDate, weekdayOf, zonedInstant } from '../../src/booking/time';

export const TZ = 'America/Bogota';
export const PASSWORD = 'Secreta123';
let counter = 0;
export const unique = () => (counter += 1);

export const auth = (session: { accessToken: string }) => ({ authorization: `Bearer ${session.accessToken}` });

/** Día hábil (lunes a sábado: el horario por defecto no abre los domingos) `offset` o más días a partir de hoy, hora de Bogotá. */
export function workday(offset: number): string {
  let date = addDays(localDate(new Date(), TZ), offset);
  while (weekdayOf(date) === 0) date = addDays(date, 1);
  return date;
}

/** Instante ISO (UTC) de "esta fecha a esta hora" en Bogotá. */
export const at = (date: string, time: string): string => zonedInstant(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)), TZ).toISOString();

export interface Biz {
  session: AuthSession;
  slug: string;
  ownerId: string;
  serviceId: string;
  base: string;
}

export async function register(app: FastifyInstance, label = 'Studio'): Promise<AuthSession> {
  const n = unique();
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Dueña', businessName: `${label} ${n}`, businessType: 'barbershop', email: `owner${n}@correo.com`, password: PASSWORD, acceptTerms: true, language: 'es' } });
  expect(res.statusCode).toBe(201);
  return res.json<AuthSession>();
}

export async function firstCategoryId(app: FastifyInstance, session: AuthSession): Promise<string> {
  return (await app.inject({ method: 'GET', url: '/api/categories', headers: auth(session) })).json<Array<{ id: string }>>()[0]!.id;
}

export async function createService(app: FastifyInstance, session: AuthSession, over: Record<string, unknown> = {}): Promise<Item> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/items',
    headers: auth(session),
    payload: { name: 'Corte', categoryId: await firstCategoryId(app, session), price: 30000, kind: 'service', durationMinutes: 60, ...over },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Item>();
}

/** Negocio listo para reservar: el dueño atiende, hay un servicio de 60 min y la página está publicada. */
export async function setupBiz(app: FastifyInstance, label = 'Studio'): Promise<Biz> {
  const session = await register(app, label);
  const ownerId = session.user.id;
  expect((await app.inject({ method: 'PATCH', url: `/api/professionals/${ownerId}`, headers: auth(session), payload: { bookable: true, publicName: 'La Dueña' } })).statusCode).toBe(200);
  const service = await createService(app, session);
  expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(session), payload: { published: true } })).statusCode).toBe(200);
  return { session, slug: session.business.slug, ownerId, serviceId: service.id, base: `/api/public/booking/${session.business.slug}` };
}

export async function createEmployee(app: FastifyInstance, owner: AuthSession, permissions: EmployeePermission[] = []) {
  const n = unique();
  const email = `emp${n}@correo.com`;
  const created = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(owner), payload: { name: `Empleado ${n}`, email, password: PASSWORD, permissions } });
  expect(created.statusCode).toBe(201);
  const employee = created.json<Employee>();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: PASSWORD } });
  expect(login.statusCode).toBe(200);
  return { employee, session: login.json<AuthSession>() };
}

let phoneCounter = 0;
export const nextPhone = () => `30${String(10_000_000 + (phoneCounter += 1))}`;

export const publicPayload = (biz: Biz, date: string, time: string, over: Record<string, unknown> = {}) => ({
  selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [] },
  professionalId: 'any',
  startsAt: at(date, time),
  customer: { firstName: 'Ana', lastName: 'Pérez', email: 'ana@correo.com', phone: nextPhone(), notes: '', custom: {} },
  acceptTerms: true,
  remindersOptIn: false,
  website: '',
  ...over,
});

export const book = (app: FastifyInstance, biz: Biz, date: string, time: string, over: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `${biz.base}/appointments`, payload: publicPayload(biz, date, time, over) });

export const availability = async (app: FastifyInstance, biz: Biz, date: string, query = '') => {
  const res = await app.inject({ method: 'GET', url: `${biz.base}/availability?date=${date}&services=${biz.serviceId}${query}` });
  return { res, body: res.json() as { slots: Array<{ time: string; startsAt: string; state: string }>; totalMinutes: number; intervalMinutes: number } };
};

export const stateAt = (slots: Array<{ time: string; state: string }>, time: string) => slots.find((s) => s.time === time)?.state;
