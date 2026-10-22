import { CLIENTS_NOT_RETURNING_THRESHOLD_DAYS, OCCUPYING_STATUSES, type AppointmentStatus } from '@xiro/shared';
import { and, count, desc, eq, gte, inArray, lt, max } from 'drizzle-orm';
import type { Ctx } from '../context';
import { appointments, clients, serviceRecords, users } from '../db/schema';

/**
 * Datos de citas y clientes para el asistente de negocio (Fase C). Mismas tablas y el mismo recorte "solo mi propia
 * agenda" que ya aplica `GET /appointments` en routes/booking.ts — se repite aquí porque ese `ownScope` es una función
 * local, no exportada. `professionalId` llega ya resuelto por quien llama (undefined = ve todas, igual que con
 * "ver todas las agendas"); esta capa nunca decide el permiso, solo filtra con lo que le dan.
 */

export interface AppointmentStatusRow {
  status: AppointmentStatus;
  count: number;
}

/** Citas del período agrupadas por estado (también responde "¿cuántas citas tengo hoy?" con period=today). */
export async function appointmentsByStatus(db: Ctx['db'], businessId: string, from: string, to: string, professionalId?: string): Promise<AppointmentStatusRow[]> {
  const rows = await db
    .select({ status: appointments.status, n: count() })
    .from(appointments)
    .where(and(eq(appointments.businessId, businessId), gte(appointments.startsAt, new Date(from)), lt(appointments.startsAt, new Date(to)), professionalId ? eq(appointments.professionalId, professionalId) : undefined))
    .groupBy(appointments.status)
    .orderBy(desc(count()));
  return rows.map((r) => ({ status: r.status as AppointmentStatus, count: r.n }));
}

export interface UpcomingAppointmentRow {
  startsAt: Date;
  clientName: string;
  professionalName: string;
  status: AppointmentStatus;
}

const UPCOMING_LIMIT = 5;

/** Las próximas citas que ocupan la agenda (estados de `OCCUPYING_STATUSES`), desde `now`. */
export async function upcomingAppointments(db: Ctx['db'], businessId: string, now: Date, professionalId?: string): Promise<UpcomingAppointmentRow[]> {
  const rows = await db
    .select({ startsAt: appointments.startsAt, status: appointments.status, clientName: clients.name, professionalName: users.name })
    .from(appointments)
    .innerJoin(clients, and(eq(clients.id, appointments.clientId), eq(clients.businessId, businessId)))
    .innerJoin(users, and(eq(users.id, appointments.professionalId), eq(users.businessId, businessId)))
    .where(and(eq(appointments.businessId, businessId), gte(appointments.startsAt, now), inArray(appointments.status, OCCUPYING_STATUSES), professionalId ? eq(appointments.professionalId, professionalId) : undefined))
    .orderBy(appointments.startsAt)
    .limit(UPCOMING_LIMIT);
  return rows.map((r) => ({ startsAt: r.startsAt, clientName: r.clientName, professionalName: r.professionalName, status: r.status as AppointmentStatus }));
}

export interface ProfessionalCountRow {
  professionalName: string;
  count: number;
}

/** Citas del período agrupadas por profesional. Con `professionalId` (sin "ver todas las agendas") la lista queda en una sola fila: la propia. */
export async function appointmentsByProfessional(db: Ctx['db'], businessId: string, from: string, to: string, professionalId?: string): Promise<ProfessionalCountRow[]> {
  const rows = await db
    .select({ professionalName: users.name, n: count() })
    .from(appointments)
    .innerJoin(users, and(eq(users.id, appointments.professionalId), eq(users.businessId, businessId)))
    .where(and(eq(appointments.businessId, businessId), gte(appointments.startsAt, new Date(from)), lt(appointments.startsAt, new Date(to)), professionalId ? eq(appointments.professionalId, professionalId) : undefined))
    .groupBy(users.id, users.name)
    .orderBy(desc(count()));
  return rows.map((r) => ({ professionalName: r.professionalName, count: r.n }));
}

/** Clientes con ficha (nunca el cliente "de mostrador": `isOccasional`) creados en el período. */
export async function countNewClients(db: Ctx['db'], businessId: string, from: string, to: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(clients)
    .where(and(eq(clients.businessId, businessId), eq(clients.isOccasional, false), gte(clients.createdAt, new Date(from)), lt(clients.createdAt, new Date(to))));
  return row?.n ?? 0;
}

/** Clientes DISTINTOS (sin el "de mostrador") con al menos un servicio no anulado registrado en el período. */
export async function countServedClients(db: Ctx['db'], businessId: string, from: string, to: string): Promise<number> {
  const rows = await db
    .select({ clientId: serviceRecords.clientId })
    .from(serviceRecords)
    .innerJoin(clients, and(eq(clients.id, serviceRecords.clientId), eq(clients.businessId, businessId)))
    .where(
      and(
        eq(serviceRecords.businessId, businessId),
        eq(serviceRecords.voided, false),
        eq(clients.isOccasional, false),
        gte(serviceRecords.createdAt, new Date(from)),
        lt(serviceRecords.createdAt, new Date(to)),
      ),
    )
    .groupBy(serviceRecords.clientId);
  return rows.length;
}

export interface NotReturningClientRow {
  name: string;
  lastVisit: string;
}

const NOT_RETURNING_LIMIT = 20;

/**
 * Clientes con ficha y AL MENOS una visita (servicio no anulado), cuya última visita fue hace más de
 * `CLIENTS_NOT_RETURNING_THRESHOLD_DAYS` días. Quien nunca ha tenido una visita no aparece aquí: no es "no ha
 * vuelto", es "nunca ha venido" (una pregunta distinta, que esta no responde).
 */
export async function clientsNotReturning(db: Ctx['db'], businessId: string, now: Date): Promise<NotReturningClientRow[]> {
  const cutoff = new Date(now.getTime() - CLIENTS_NOT_RETURNING_THRESHOLD_DAYS * 24 * 3_600_000);
  const rows = await db
    .select({ name: clients.name, lastVisit: max(serviceRecords.createdAt) })
    .from(serviceRecords)
    .innerJoin(clients, and(eq(clients.id, serviceRecords.clientId), eq(clients.businessId, businessId)))
    .where(and(eq(serviceRecords.businessId, businessId), eq(serviceRecords.voided, false), eq(clients.isOccasional, false)))
    .groupBy(serviceRecords.clientId, clients.name)
    .having(lt(max(serviceRecords.createdAt), cutoff))
    .orderBy(max(serviceRecords.createdAt))
    .limit(NOT_RETURNING_LIMIT);
  return rows.map((r) => ({ name: r.name, lastVisit: r.lastVisit!.toISOString().slice(0, 10) }));
}
