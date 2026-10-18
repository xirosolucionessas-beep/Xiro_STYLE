import { createHash } from 'node:crypto';
import { canTransition, type AppointmentDto, type AppointmentItemDto, type AppointmentSource, type AppointmentStatus, type BookingSelection, type PublicAppointmentDto } from '@xiro/shared';
import { and, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { isExclusionViolation, isUniqueViolation } from '../db/errors';
import { appointmentEvents, appointmentItems, appointments, businessPublicProfiles, clients, employeeProfiles, reviews, users } from '../db/schema';
import { AppError, notFound } from '../errors';
import { deriveToken, randomToken } from '../security';
import { alternativesAround, evaluateStart, orderedCandidates, pickProfessional, prepare, type BookingContext, type Prepared } from './availability';
import type { Tx } from './scope';
import { discountCodesById, discountOf } from './discounts';
import { allSections } from './view';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export type AppointmentRow = typeof appointments.$inferSelect;
export type PublicProfileRow = typeof businessPublicProfiles.$inferSelect;
type ItemRow = typeof appointmentItems.$inferSelect;

const HOUR = 3_600_000;
/** Tras la cita el enlace de gestión sigue sirviendo un día más (por si hay que reseñar) y luego caduca. */
const TOKEN_GRACE_MS = 24 * HOUR;

export type Actor = { kind: 'staff'; userId: string } | { kind: 'client' } | { kind: 'system' };

async function addEvent(tx: Tx, businessId: string, appointmentId: string, type: string, actor: Actor, data: Record<string, string | number | boolean | null> = {}): Promise<void> {
  await tx.insert(appointmentEvents).values({ businessId, appointmentId, type, actorKind: actor.kind, actorUserId: actor.kind === 'staff' ? actor.userId : null, data });
}

const slotTaken = (alternatives: unknown) => new AppError(409, 'slot_taken', undefined, undefined, { alternatives });

/* ---------- Clientes ---------- */

interface ClientInput {
  name: string;
  phone?: string | undefined;
  email?: string | undefined;
}

/**
 * Busca al cliente por su celular dentro del negocio o lo crea. NUNCA modifica lo que ya existe (ni el nombre) y la
 * respuesta pública es idéntica en ambos casos: quien reserva no puede averiguar si ese número ya era cliente.
 */
export async function findOrCreateClient(tx: Tx, businessId: string, input: ClientInput): Promise<string> {
  if (input.phone) {
    // Dos reservas simultáneas con el mismo celular en el mismo negocio no deben crear dos clientes: el candado se libera solo al
    // terminar la transacción y es por (negocio, celular), así que no frena a nadie más.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${businessId}:${input.phone}`}, 0))`);
    const [existing] = await tx.select().from(clients).where(and(eq(clients.businessId, businessId), eq(clients.phone, input.phone))).limit(1);
    if (existing) {
      if (!existing.email && input.email) await tx.update(clients).set({ email: input.email }).where(and(eq(clients.id, existing.id), eq(clients.businessId, businessId)));
      return existing.id;
    }
  }
  const [created] = await tx.insert(clients).values({ businessId, name: input.name, phone: input.phone ?? null, email: input.email ?? null }).returning({ id: clients.id });
  return created!.id;
}

async function assertClient(tx: Tx, businessId: string, clientId: string): Promise<void> {
  const [row] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.businessId, businessId))).limit(1);
  if (!row) throw notFound();
}

/* ---------- Crear ---------- */

export interface CreateInput {
  now: Date;
  startsAt: Date;
  source: AppointmentSource;
  client: { id: string } | { create: ClientInput };
  /** Cuenta de cliente que hace la reserva, si inició sesión (ver client_accounts); null = invitado. */
  clientAccountId?: string | null;
  customerNotes: string;
  internalNotes: string;
  createdBy: string | null;
  /** Reserva hecha por el propio cliente en la página pública. */
  publicFlow: boolean;
  termsIp?: string | null;
  remindersOptIn: boolean;
  /**
   * Confirmación idempotente (solo página pública). `key` es el UUID del intento; `secret` firma el enlace de gestión para que
   * un reintento pueda devolverlo sin haber guardado el enlace en claro (en la base solo está su hash).
   */
  idempotency?: { key: string; secret: string };
}

export interface CreatedAppointment {
  row: AppointmentRow;
  token: string | null;
  /** true si esta petición repetía una ya atendida: no se creó nada y no debe avisarse ni programarse nada otra vez. */
  replayed: boolean;
}

export const idempotencyHash = (businessId: string, key: string): string => createHash('sha256').update(`${businessId}:${key}`).digest('hex');

export async function findByIdempotency(tx: Tx, businessId: string, hash: string): Promise<AppointmentRow | null> {
  const [row] = await tx.select().from(appointments).where(and(eq(appointments.businessId, businessId), eq(appointments.idempotencyHash, hash))).limit(1);
  return row ?? null;
}

export async function createAppointment(tx: Tx, businessId: string, p: Prepared, input: CreateInput): Promise<CreatedAppointment> {
  // Primero de todo: si ya se atendió esta misma confirmación, se devuelve esa cita. Va ANTES de mirar la disponibilidad: el horario
  // ya lo ocupa la cita del primer envío y, mirado de nuevo, respondería "horario ocupado" a alguien que sí reservó.
  const idem = input.publicFlow && input.idempotency ? { hash: idempotencyHash(businessId, input.idempotency.key), token: deriveToken(input.idempotency.secret, businessId, input.idempotency.key) } : null;
  // Lectura confirmada: cada consulta ve lo que otras transacciones ya confirmaron. Si un envío simultáneo con la MISMA clave
  // se confirmó después de esta primera búsqueda, su cita ocupa el horario (o cuenta como pendiente): antes de responder
  // "horario ocupado" o "demasiadas pendientes" se vuelve a buscar la clave y se devuelve esa cita, que es la de este intento.
  const replay = async (): Promise<CreatedAppointment | null> => {
    if (!idem) return null;
    const prior = await findByIdempotency(tx, businessId, idem.hash);
    return prior ? { row: prior, token: idem.token, replayed: true } : null;
  };
  const first = await replay();
  if (first) return first;

  const evaluation = await evaluateStart(tx, businessId, p, input.now, input.startsAt);
  if (input.publicFlow && !evaluation.onGrid) throw new AppError(400, 'slot_not_allowed');
  const candidates = orderedCandidates(evaluation);
  if (candidates.length === 0) {
    const committed = await replay();
    if (committed) return committed;
    throw slotTaken(await alternativesAround(tx, businessId, p, input.now, input.startsAt));
  }

  const clientId = 'id' in input.client ? (await assertClient(tx, businessId, input.client.id), input.client.id) : await findOrCreateClient(tx, businessId, input.client.create);

  if (input.publicFlow) {
    const pending = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.businessId, businessId), eq(appointments.clientId, clientId), eq(appointments.source, 'web'), inArray(appointments.status, ['pending', 'confirmed']), gt(appointments.startsAt, input.now)));
    if (pending.length >= p.ctx.settings.maxPendingPerPhone) {
      const committed = await replay();
      if (committed) return committed;
      throw new AppError(429, 'too_many_pending');
    }
  }

  const status: AppointmentStatus = input.publicFlow && !p.ctx.settings.autoConfirm ? 'pending' : 'confirmed';
  const token = input.publicFlow ? (idem?.token ?? randomToken(32)) : null;

  // Con "Primero disponible" se prueba a cada profesional libre por orden de preferencia: si otra reserva simultánea se llevó al
  // primero, el cliente no pierde el horario mientras otro profesional siga libre. Solo cuando TODOS fallan es `slot_taken`.
  for (const chosen of candidates) {
    const price = evaluation.priced.get(chosen.id)!;
    const endsAt = new Date(input.startsAt.getTime() + price.minutes * 60_000);
    const busyUntil = new Date(endsAt.getTime() + price.cleanup * 60_000);
    try {
      // Punto de guardado: si la restricción de exclusión rechaza la cita (otra reserva llegó a la vez), la transacción de la petición sigue viva.
      const row = await tx.transaction(async (sp) => {
        const [created] = await sp
          .insert(appointments)
          .values({
            businessId,
            clientId,
            professionalId: chosen.id,
            startsAt: input.startsAt,
            endsAt,
            busyUntil,
            status,
            source: input.source,
            customerNotes: input.customerNotes,
            internalNotes: input.internalNotes,
            totalPrice: price.total,
            durationMinutes: price.minutes,
            tokenHash: token ? hashToken(token) : null,
            tokenExpiresAt: token ? new Date(endsAt.getTime() + TOKEN_GRACE_MS) : null,
            termsAcceptedAt: input.publicFlow ? input.now : null,
            termsAcceptedIp: input.publicFlow ? (input.termsIp ?? null) : null,
            remindersOptIn: input.remindersOptIn,
            createdBy: input.createdBy,
            clientAccountId: input.clientAccountId ?? null,
            idempotencyHash: idem?.hash ?? null,
          })
          .returning();
        const appointment = created!;
        await sp.insert(appointmentItems).values(
          p.resolved.lines.map((line) => {
            const own = line.kind === 'service' && !line.variantId && line.itemId ? chosen.overrides.get(line.itemId) : undefined;
            return {
              businessId,
              appointmentId: appointment.id,
              kind: line.kind,
              itemId: line.itemId,
              variantId: line.variantId,
              packageId: line.packageId,
              name: line.name,
              price: own?.price ?? line.price,
              durationMinutes: own?.minutes ?? line.minutes,
              quantity: line.quantity,
            };
          }),
        );
        await addEvent(sp, businessId, appointment.id, 'created', input.createdBy ? { kind: 'staff', userId: input.createdBy } : { kind: 'client' }, { source: input.source, status });
        return appointment;
      });
      return { row, token, replayed: false };
    } catch (error) {
      // Dos envíos simultáneos con la misma clave: el segundo choca con el índice único o con la restricción de horario del
      // primero. En ambos casos lo correcto es devolver la cita del primero, no un error.
      if (idem && (isUniqueViolation(error, 'appointments_idem_uq') || isUniqueViolation(error, 'appointments_token_uq') || isExclusionViolation(error))) {
        const prior = await findByIdempotency(tx, businessId, idem.hash);
        if (prior) return { row: prior, token: idem.token, replayed: true };
      }
      if (!isExclusionViolation(error)) throw error;
    }
  }
  throw slotTaken(await alternativesAround(tx, businessId, p, input.now, input.startsAt));
}

/* ---------- Leer ---------- */

const toItemDto = (row: ItemRow): AppointmentItemDto => ({ id: row.id, kind: row.kind as AppointmentItemDto['kind'], itemId: row.itemId, variantId: row.variantId, packageId: row.packageId, name: row.name, price: row.price, durationMinutes: row.durationMinutes, quantity: row.quantity });

/** Citas con su cliente, profesional y líneas (vista del personal: incluye notas internas). */
export async function loadAppointmentDtos(tx: Tx, businessId: string, where: SQL | undefined, limit = 500): Promise<AppointmentDto[]> {
  const rows = await tx
    .select({ a: appointments, clientName: clients.name, clientPhone: clients.phone, clientEmail: clients.email, proName: users.name })
    .from(appointments)
    .innerJoin(clients, and(eq(clients.id, appointments.clientId), eq(clients.businessId, businessId)))
    .innerJoin(users, and(eq(users.id, appointments.professionalId), eq(users.businessId, businessId)))
    .where(and(eq(appointments.businessId, businessId), where))
    .orderBy(appointments.startsAt)
    .limit(limit);
  if (rows.length === 0) return [];
  const lines = await tx
    .select()
    .from(appointmentItems)
    .where(and(eq(appointmentItems.businessId, businessId), inArray(appointmentItems.appointmentId, rows.map((r) => r.a.id))));
  const codes = await discountCodesById(tx, businessId, rows.map((r) => r.a.discountCodeId));
  return rows.map(({ a, clientName, clientPhone, clientEmail, proName }) => ({
    id: a.id,
    status: a.status as AppointmentStatus,
    source: a.source as AppointmentSource,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    durationMinutes: a.durationMinutes,
    totalPrice: a.totalPrice,
    discount: discountOf(a, codes),
    customerNotes: a.customerNotes,
    internalNotes: a.internalNotes,
    modificationCount: a.modificationCount,
    createdAt: a.createdAt.toISOString(),
    professional: { id: a.professionalId, name: proName },
    client: { id: a.clientId, name: clientName, phone: clientPhone, email: clientEmail },
    items: lines.filter((l) => l.appointmentId === a.id).map(toItemDto),
  }));
}

/** Lo que el cliente ve de SU cita (nunca notas internas, ni datos de otras personas, ni el correo/celular del profesional). */
export async function toPublicAppointment(tx: Tx, ctx: BookingContext, businessId: string, row: AppointmentRow, now: Date, profile: PublicProfileRow | null): Promise<PublicAppointmentDto> {
  const lines = await tx.select().from(appointmentItems).where(and(eq(appointmentItems.businessId, businessId), eq(appointmentItems.appointmentId, row.id)));
  const [pro] = await tx
    .select({ name: users.name, publicName: employeeProfiles.publicName })
    .from(users)
    .leftJoin(employeeProfiles, and(eq(employeeProfiles.userId, users.id), eq(employeeProfiles.businessId, businessId)))
    .where(and(eq(users.id, row.professionalId), eq(users.businessId, businessId)))
    .limit(1);
  const changeableUntil = new Date(row.startsAt.getTime() - ctx.settings.cancelUntilHours * HOUR);
  const active = row.status === 'pending' || row.status === 'confirmed';
  const canCancel = active && now.getTime() <= changeableUntil.getTime();
  const modificationsLeft = Math.max(0, ctx.settings.maxModifications - row.modificationCount);
  const [existingReview] = row.status === 'completed' ? await tx.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.appointmentId, row.id), eq(reviews.businessId, businessId))).limit(1) : [];
  const { business } = ctx;
  // El pin solo sale si el negocio dejó activa la sección "mapa" (mismo criterio que la página pública).
  const showPin = profile !== null && profile.latitude !== null && profile.longitude !== null && allSections(profile.sections).map;
  return {
    status: row.status as AppointmentStatus,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    durationMinutes: row.durationMinutes,
    totalPrice: row.totalPrice,
    discount: discountOf(row, await discountCodesById(tx, businessId, [row.discountCodeId])),
    professionalName: pro?.publicName || pro?.name || '',
    items: lines.map(toItemDto),
    business: {
      name: profile?.displayName || business.name,
      slug: business.slug,
      address: business.address,
      city: business.city,
      phone: profile?.phone || null,
      whatsapp: business.whatsapp,
      timezone: business.timezone,
      currency: business.currency,
      location: showPin ? { latitude: profile.latitude!, longitude: profile.longitude!, placeId: profile.placeId, address: profile.mapAddress } : null,
    },
    canCancel,
    canReschedule: canCancel && modificationsLeft > 0,
    modificationsLeft,
    changeableUntil: changeableUntil.toISOString(),
    canReview: row.status === 'completed' && !existingReview,
  };
}

/** "María Rodríguez" → "María R." — lo único del cliente que se muestra en una reseña pública. */
export function shortAuthorName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}

/** El cliente reseña SU cita ya completada, con el enlace de gestión. Una sola reseña por cita, y solo tras completarla. */
export async function submitReview(tx: Tx, businessId: string, appointmentId: string, input: { rating: number; comment: string }): Promise<typeof reviews.$inferSelect> {
  const [row] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, businessId))).limit(1);
  if (!row) throw notFound();
  if (row.status !== 'completed') throw new AppError(409, 'invalid_transition');
  const [client] = await tx.select({ name: clients.name }).from(clients).where(and(eq(clients.id, row.clientId), eq(clients.businessId, businessId))).limit(1);
  try {
    const [created] = await tx
      .insert(reviews)
      .values({ businessId, appointmentId, rating: input.rating, comment: input.comment, authorName: shortAuthorName(client?.name ?? '') || 'Cliente' })
      .returning();
    return created!;
  } catch (error) {
    if (isUniqueViolation(error, 'reviews_appointment_uq')) throw new AppError(409, 'invalid_transition'); // ya había una reseña
    throw error;
  }
}

/** Nombre del cliente para el texto de un aviso push al profesional (nunca se expone al cliente mismo: ver toPublicAppointment). */
export async function clientNameOf(tx: Tx, businessId: string, clientId: string): Promise<string> {
  const [row] = await tx.select({ name: clients.name }).from(clients).where(and(eq(clients.id, clientId), eq(clients.businessId, businessId))).limit(1);
  return row?.name ?? '';
}

async function lockAppointment(tx: Tx, businessId: string, id: string): Promise<AppointmentRow> {
  const [row] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.businessId, businessId))).limit(1).for('update');
  if (!row) throw notFound();
  return row;
}

/* ---------- Cambiar estado ---------- */

export async function transitionAppointment(tx: Tx, businessId: string, id: string, to: AppointmentStatus, reason: string, actor: Actor, now: Date, scopeProfessionalId?: string, guard?: (row: AppointmentRow) => void): Promise<AppointmentRow> {
  const row = await lockAppointment(tx, businessId, id);
  guard?.(row);
  // Un empleado sin "ver todas las agendas" solo toca las citas propias; las demás responden 404, no 403 (no confirma que existan).
  if (scopeProfessionalId && row.professionalId !== scopeProfessionalId) throw notFound();
  const from = row.status as AppointmentStatus;
  if (!canTransition(from, to)) throw new AppError(409, 'invalid_transition');
  if (to === 'no_show' && now.getTime() < row.startsAt.getTime()) throw new AppError(409, 'invalid_transition');
  const [updated] = await tx
    .update(appointments)
    .set({ status: to, updatedAt: now, ...(to === 'cancelled' ? { cancelledAt: now, cancelReason: reason } : {}) })
    .where(and(eq(appointments.id, id), eq(appointments.businessId, businessId)))
    .returning();
  await addEvent(tx, businessId, id, 'status', actor, { from, to });
  return updated!;
}

/* ---------- Reprogramar ---------- */

export interface RescheduleInput {
  now: Date;
  startsAt?: Date | undefined;
  /** 'any' o un profesional en concreto; sin valor conserva al actual. */
  professionalId?: string | undefined;
  actor: Actor;
  /** El cambio lo pide el cliente desde su enlace: cuenta como modificación. */
  clientInitiated: boolean;
  scopeProfessionalId?: string | undefined;
  /** Se ejecuta con la cita ya bloqueada (reglas de cancelación / tope de modificaciones sin carreras). */
  guard?: ((row: AppointmentRow) => void) | undefined;
}

/** Reconstruye lo reservado (servicios y paquetes; los productos no ocupan tiempo) para revalidar el horario. */
async function selectionOf(tx: Tx, businessId: string, appointmentId: string): Promise<BookingSelection> {
  const lines = await tx.select().from(appointmentItems).where(and(eq(appointmentItems.businessId, businessId), eq(appointmentItems.appointmentId, appointmentId)));
  return {
    services: lines.filter((l) => l.kind === 'service' && l.itemId).map((l) => ({ itemId: l.itemId!, variantId: l.variantId })),
    packages: lines.filter((l) => l.kind === 'package' && l.packageId).map((l) => l.packageId!),
    products: [],
  };
}

export async function rescheduleAppointment(tx: Tx, businessId: string, ctx: BookingContext, id: string, input: RescheduleInput): Promise<AppointmentRow> {
  const row = await lockAppointment(tx, businessId, id);
  if (input.scopeProfessionalId && row.professionalId !== input.scopeProfessionalId) throw notFound();
  input.guard?.(row);
  if (row.status !== 'pending' && row.status !== 'confirmed') throw new AppError(409, 'invalid_transition');

  const staff = !input.clientInitiated;
  const startsAt = input.startsAt ?? row.startsAt;
  const professionalId = input.professionalId ?? row.professionalId;
  const p = await prepare(tx, businessId, { selection: await selectionOf(tx, businessId, id), professionalId, staff, ctx });
  const evaluation = await evaluateStart(tx, businessId, p, input.now, startsAt, id);
  if (!staff && !evaluation.onGrid) throw new AppError(400, 'slot_not_allowed');
  const chosen = pickProfessional(evaluation);
  if (!chosen) throw slotTaken(await alternativesAround(tx, businessId, p, input.now, startsAt, 6, id));

  // La duración y el precio quedan CONGELADOS desde la reserva: mover la cita no cambia lo pactado.
  const span = row.busyUntil.getTime() - row.startsAt.getTime();
  const serviceSpan = row.endsAt.getTime() - row.startsAt.getTime();
  try {
    const [updated] = await tx.transaction(async (sp) =>
      sp
        .update(appointments)
        .set({
          startsAt,
          endsAt: new Date(startsAt.getTime() + serviceSpan),
          busyUntil: new Date(startsAt.getTime() + span),
          professionalId: chosen.id,
          updatedAt: input.now,
          modificationCount: row.modificationCount + (input.clientInitiated ? 1 : 0),
        })
        .where(and(eq(appointments.id, id), eq(appointments.businessId, businessId)))
        .returning(),
    );
    await addEvent(tx, businessId, id, 'rescheduled', input.actor, { from: row.startsAt.toISOString(), to: startsAt.toISOString(), professionalChanged: chosen.id !== row.professionalId });
    return updated!;
  } catch (error) {
    if (isExclusionViolation(error)) throw slotTaken(await alternativesAround(tx, businessId, p, input.now, startsAt, 6, id));
    throw error;
  }
}

/** Notas de una cita (sin tocar horario). */
export async function updateNotes(tx: Tx, businessId: string, id: string, notes: { internalNotes?: string | undefined; customerNotes?: string | undefined }, actor: Actor, scopeProfessionalId?: string): Promise<AppointmentRow> {
  const row = await lockAppointment(tx, businessId, id);
  if (scopeProfessionalId && row.professionalId !== scopeProfessionalId) throw notFound();
  const [updated] = await tx
    .update(appointments)
    .set({ ...(notes.internalNotes !== undefined ? { internalNotes: notes.internalNotes } : {}), ...(notes.customerNotes !== undefined ? { customerNotes: notes.customerNotes } : {}), updatedAt: new Date() })
    .where(and(eq(appointments.id, id), eq(appointments.businessId, businessId)))
    .returning();
  await addEvent(tx, businessId, id, 'notes', actor);
  return updated!;
}

/* ---------- Reglas de la página pública ---------- */

/** Reglas del cliente sobre SU cita: ventana de cancelación y tope de modificaciones. */
export function assertClientMayChange(ctx: BookingContext, row: AppointmentRow, now: Date, kind: 'cancel' | 'reschedule'): void {
  if (row.status !== 'pending' && row.status !== 'confirmed') throw new AppError(409, 'invalid_transition');
  if (now.getTime() > row.startsAt.getTime() - ctx.settings.cancelUntilHours * HOUR) throw new AppError(409, 'cancel_window_passed');
  if (kind === 'reschedule' && row.modificationCount >= ctx.settings.maxModifications) throw new AppError(409, 'modifications_exceeded');
}

export { lockAppointment };
