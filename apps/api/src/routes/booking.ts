import {
  appointmentPatchSchema,
  appointmentsQuerySchema,
  appointmentTransitionSchema,
  availabilityQuerySchema,
  bookingSelectionSchema,
  can,
  classificationConfirmSchema,
  daysQuerySchema,
  packageInputSchema,
  staffAppointmentInputSchema,
  variantInputSchema,
  type AppointmentDto,
  type AvailabilityResponse,
  type BookingSelection,
  type ClassificationEntry,
  type DaySummary,
  type PackageDto,
  type VariantDto,
} from '@xiro/shared';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAppointment, loadAppointmentDtos, rescheduleAppointment, transitionAppointment, updateNotes, type Actor } from '../booking/appointments';
import { prepare, slotsForDays, toPublicSlot, loadContext } from '../booking/availability';
import { applyCompletion } from '../booking/completion';
import { withBusiness, withBusinessTrusted, type Tx } from '../booking/scope';
import { formatPushMoment, notifyAppointment, notifyBusiness, notifyLowStockIfNeeded } from '../push';
import type { Ctx } from '../context';
import { appointments, categories, items, servicePackageEntries, servicePackages, serviceVariants } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import { cancelReminder, scheduleReminder } from '../jobs/reminders';
import { issueSseTicket } from '../sseTickets';

/** Lo elegido viaja en la consulta como `services=id:estilo,id` y `packages=id,id`. */
export function selectionFromQuery(query: { services: string; packages: string }): BookingSelection {
  const services = query.services
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [itemId, variantId] = part.split(':');
      return { itemId: itemId ?? '', variantId: variantId || null };
    });
  const packages = query.packages
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parse(bookingSelectionSchema, { services, packages, products: [] });
}

const MAX_RANGE_MS = 93 * 24 * 3_600_000;
const classificationQuery = z.object({ all: z.enum(['0', '1']).default('0') });

/**
 * Agenda del personal: citas, disponibilidad y la organización de servicios (estilos, paquetes, clasificación).
 * El negocio sale SIEMPRE de la sesión; una cita, cliente o servicio de otro negocio responde 404 igual que uno inexistente.
 * Sin "ver todas las agendas" un empleado solo ve y toca sus propias citas.
 */
export function bookingRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const scoped = <T>(request: { user: { bid: string } }, fn: (tx: Tx) => Promise<T>) => withBusiness(db, request.user.bid, fn);
  const staffActor = (request: { actor: { id: string } }): Actor => ({ kind: 'staff', userId: request.actor.id });
  /** Sin "ver todas las agendas": el id del profesional al que se limita todo lo que hace. */
  const ownScope = (request: { actor: Parameters<typeof can>[0] & { id: string } }): string | undefined => (can(request.actor, 'agenda_all') ? undefined : request.actor.id);

  /* ---------- Citas ---------- */

  app.get('/appointments', async (request): Promise<AppointmentDto[]> => {
    const query = parse(appointmentsQuerySchema, request.query);
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (!(from < to) || to.getTime() - from.getTime() > MAX_RANGE_MS) throw new AppError(400, 'date_invalid');
    const own = ownScope(request);
    const professionalId = own ?? (query.professionalId ? uuid(query.professionalId) : undefined);
    return scoped(request, (tx) =>
      loadAppointmentDtos(tx, request.user.bid, and(gte(appointments.startsAt, from), lt(appointments.startsAt, to), professionalId ? eq(appointments.professionalId, professionalId) : undefined, query.status ? eq(appointments.status, query.status) : undefined)),
    );
  });

  app.get('/appointments/:id', async (request): Promise<AppointmentDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const own = ownScope(request);
    const [dto] = await scoped(request, (tx) => loadAppointmentDtos(tx, request.user.bid, and(eq(appointments.id, id), own ? eq(appointments.professionalId, own) : undefined)));
    if (!dto) throw notFound();
    return dto;
  });

  /** Ticket de un solo uso para abrir el stream de "algo cambió" (ver routes/realtime.ts): `EventSource` no puede
   * mandar el header de sesión, así que esta ruta SÍ autenticada normal es la única forma de conseguir uno. */
  app.post('/booking/events/ticket', async (request): Promise<{ ticket: string }> => ({ ticket: issueSseTicket(request.user.bid) }));

  app.post('/appointments', async (request, reply) => {
    const input = parse(staffAppointmentInputSchema, request.body);
    const own = ownScope(request);
    if (own && input.professionalId.toLowerCase() !== own) throw new AppError(403, 'forbidden');
    let timezone = '';
    const dto = await scoped(request, async (tx) => {
      const p = await prepare(tx, request.user.bid, { selection: input.selection, professionalId: input.professionalId, staff: true });
      timezone = p.ctx.business.timezone;
      const { row } = await createAppointment(tx, request.user.bid, p, {
        now: new Date(),
        startsAt: new Date(input.startsAt),
        source: input.source,
        client: input.clientId ? { id: uuid(input.clientId) } : { create: input.newClient! },
        customerNotes: input.customerNotes,
        internalNotes: input.internalNotes,
        createdBy: request.actor.id,
        publicFlow: false,
        remindersOptIn: false,
      });
      return (await loadAppointmentDtos(tx, request.user.bid, eq(appointments.id, row.id)))[0]!;
    });
    // Solo avisa cuando otra persona agenda EN NOMBRE del profesional (p. ej. un encargado con "ver todas las agendas").
    void notifyAppointment({ db, config: ctx.config }, request.user.bid, dto.professional.id, request.actor.id, 'appointments', {
      titleKey: 'push_appt_new_title',
      bodyKey: 'push_appt_new_body',
      params: { client: dto.client.name, time: formatPushMoment(dto.startsAt, timezone) },
      dedupeKey: `appt_new:${dto.id}`,
      href: '/agenda',
    });
    void scheduleReminder(ctx.boss, request.user.bid, dto.id, new Date(dto.startsAt));
    return reply.status(201).send(dto);
  });

  app.patch('/appointments/:id', async (request): Promise<AppointmentDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(appointmentPatchSchema, request.body);
    const own = ownScope(request);
    if (own && input.professionalId && input.professionalId.toLowerCase() !== own) throw new AppError(403, 'forbidden');
    let moved = false;
    let timezone = '';
    const dto = await scoped(request, async (tx) => {
      const bookingCtx = await loadContext(tx, request.user.bid);
      timezone = bookingCtx.business.timezone;
      if (input.startsAt || input.professionalId) {
        await rescheduleAppointment(tx, request.user.bid, bookingCtx, id, { now: new Date(), startsAt: input.startsAt ? new Date(input.startsAt) : undefined, professionalId: input.professionalId, actor: staffActor(request), clientInitiated: false, scopeProfessionalId: own });
        moved = true;
      }
      if (input.internalNotes !== undefined || input.customerNotes !== undefined) {
        await updateNotes(tx, request.user.bid, id, { internalNotes: input.internalNotes, customerNotes: input.customerNotes }, staffActor(request), own);
      }
      const [dto] = await loadAppointmentDtos(tx, request.user.bid, eq(appointments.id, id));
      if (!dto) throw notFound();
      return dto;
    });
    if (moved) {
      void notifyAppointment({ db, config: ctx.config }, request.user.bid, dto.professional.id, request.actor.id, 'appointments', {
        titleKey: 'push_appt_rescheduled_title',
        bodyKey: 'push_appt_rescheduled_body',
        params: { time: formatPushMoment(dto.startsAt, timezone) },
        dedupeKey: `appt_reschedule:${dto.id}:${dto.startsAt}`,
        href: '/agenda',
      });
      void scheduleReminder(ctx.boss, request.user.bid, dto.id, new Date(dto.startsAt));
    }
    return dto;
  });

  app.post('/appointments/:id/status', async (request): Promise<AppointmentDto & { rewardJustEarned?: boolean }> => {
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(appointmentTransitionSchema, request.body);
    const businessId = request.user.bid;
    if (input.status !== 'completed') {
      let timezone = '';
      const dto = await scoped(request, async (tx) => {
        timezone = (await loadContext(tx, businessId)).business.timezone;
        await transitionAppointment(tx, businessId, id, input.status, input.reason, staffActor(request), new Date(), ownScope(request));
        return (await loadAppointmentDtos(tx, businessId, eq(appointments.id, id)))[0]!;
      });
      if (input.status === 'cancelled') {
        void notifyAppointment({ db, config: ctx.config }, businessId, dto.professional.id, request.actor.id, 'appointments', {
          titleKey: 'push_appt_cancelled_title',
          bodyKey: 'push_appt_cancelled_body',
          params: { time: formatPushMoment(dto.startsAt, timezone) },
          dedupeKey: `appt_cancel:${dto.id}`,
          href: '/agenda',
        });
      }
      if (input.status === 'cancelled' || input.status === 'no_show') void cancelReminder(ctx.boss, id);
      return dto;
    }
    // Completar cobra los servicios, suma sellos y descuenta productos: todo en una transacción (ver booking/completion.ts).
    const { dto, effects, clientName } = await withBusinessTrusted(db, businessId, async (tx) => {
      const row = await transitionAppointment(tx, businessId, id, 'completed', input.reason, staffActor(request), new Date(), ownScope(request));
      const applied = await applyCompletion(tx, businessId, row, request.actor.id);
      const [dto] = await loadAppointmentDtos(tx, businessId, eq(appointments.id, id));
      return { dto: dto!, effects: applied, clientName: dto!.client.name };
    });
    // Avisos de mejor esfuerzo, fuera de la transacción (igual que al registrar un servicio a mano).
    if (effects.rewardJustEarned) {
      void notifyBusiness({ db, config: ctx.config }, businessId, 'loyalty', { titleKey: 'push_loyalty_reward_title', bodyKey: 'push_loyalty_reward_body', params: { client: clientName }, dedupeKey: `loyalty:${id}`, href: `/client/${dto.client.id}` });
    }
    for (const item of effects.stockMoved) void notifyLowStockIfNeeded({ db, config: ctx.config }, businessId, item);
    void cancelReminder(ctx.boss, id);
    return { ...dto, rewardJustEarned: effects.rewardJustEarned };
  });

  /* ---------- Disponibilidad (vista del personal: puede agendar dentro de la anticipación mínima) ---------- */

  app.get('/booking/availability', async (request): Promise<AvailabilityResponse> => {
    const query = parse(availabilityQuerySchema, request.query);
    return scoped(request, async (tx) => {
      const p = await prepare(tx, request.user.bid, { selection: selectionFromQuery(query), professionalId: query.professionalId, staff: true });
      const [day] = await slotsForDays(tx, request.user.bid, p, new Date(), query.date, 1, query.excludeAppointmentId?.toLowerCase());
      return { date: query.date, timezone: p.ctx.business.timezone, intervalMinutes: p.ctx.settings.slotIntervalMinutes, totalMinutes: day!.totalMinutes, slots: day!.slots.map(toPublicSlot) };
    });
  });

  app.get('/booking/days', async (request): Promise<DaySummary[]> => {
    const query = parse(daysQuerySchema, request.query);
    return scoped(request, async (tx) => {
      const p = await prepare(tx, request.user.bid, { selection: selectionFromQuery(query), professionalId: query.professionalId, staff: true });
      const days = await slotsForDays(tx, request.user.bid, p, new Date(), query.from, query.days, query.excludeAppointmentId?.toLowerCase());
      return days.map((d) => ({ date: d.date, open: d.open, hasAvailability: d.slots.some((s) => s.state === 'available') }));
    });
  });

  /* ---------- Revisión servicio / producto ---------- */

  app.get('/items/classification', async (request): Promise<ClassificationEntry[]> => {
    const { all } = parse(classificationQuery, request.query);
    const rows = await db
      .select({ row: items, categoryName: categories.name })
      .from(items)
      .innerJoin(categories, and(eq(categories.id, items.categoryId), eq(categories.businessId, items.businessId)))
      .where(and(eq(items.businessId, request.user.bid), all === '1' ? undefined : eq(items.kindConfirmed, false)))
      .orderBy(asc(items.name));
    return rows.map(({ row, categoryName }) => ({
      id: row.id,
      name: row.name,
      categoryName,
      price: row.price,
      stock: row.stock,
      suggestedKind: row.stock > 0 ? 'product' : 'service',
      kind: row.kind as ClassificationEntry['kind'],
      durationMinutes: row.durationMinutes,
    }));
  });

  app.post('/items/classification', async (request): Promise<{ confirmed: number }> => {
    const { entries } = parse(classificationConfirmSchema, request.body);
    const businessId = request.user.bid;
    const ids = entries.map((e) => uuid(e.itemId));
    if (new Set(ids).size !== ids.length) throw new AppError(400, 'validation_error');
    await db.transaction(async (tx) => {
      const found = await tx.select({ id: items.id }).from(items).where(and(eq(items.businessId, businessId), inArray(items.id, ids)));
      if (found.length !== ids.length) throw notFound();
      for (const entry of entries) {
        await tx
          .update(items)
          .set({ kind: entry.kind, kindConfirmed: true, ...(entry.kind === 'service' && entry.durationMinutes ? { durationMinutes: entry.durationMinutes } : {}), updatedAt: new Date() })
          .where(and(eq(items.id, entry.itemId.toLowerCase()), eq(items.businessId, businessId)));
      }
    });
    return { confirmed: entries.length };
  });

  /* ---------- Estilos (variantes) de un servicio ---------- */

  const toVariant = (row: typeof serviceVariants.$inferSelect): VariantDto => ({ id: row.id, itemId: row.itemId, name: row.name, description: row.description, price: row.price, durationMinutes: row.durationMinutes, active: row.active, sortOrder: row.sortOrder });

  async function requireService(tx: Tx, businessId: string, itemId: string): Promise<void> {
    const [row] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, itemId), eq(items.businessId, businessId), eq(items.kind, 'service'))).limit(1);
    if (!row) throw notFound();
  }

  app.get('/items/:id/variants', async (request): Promise<VariantDto[]> => {
    const itemId = uuid((request.params as { id?: string }).id);
    return scoped(request, async (tx) => {
      await requireService(tx, request.user.bid, itemId);
      return (await tx.select().from(serviceVariants).where(and(eq(serviceVariants.itemId, itemId), eq(serviceVariants.businessId, request.user.bid))).orderBy(asc(serviceVariants.sortOrder), asc(serviceVariants.name))).map(toVariant);
    });
  });

  app.post('/items/:id/variants', async (request, reply) => {
    const itemId = uuid((request.params as { id?: string }).id);
    const input = parse(variantInputSchema, request.body);
    const row = await scoped(request, async (tx) => {
      await requireService(tx, request.user.bid, itemId);
      const count = await tx.select({ n: sql<number>`count(*)::int` }).from(serviceVariants).where(and(eq(serviceVariants.itemId, itemId), eq(serviceVariants.businessId, request.user.bid)));
      if ((count[0]?.n ?? 0) >= 30) throw new AppError(400, 'validation_error');
      const [created] = await tx.insert(serviceVariants).values({ businessId: request.user.bid, itemId, ...input }).returning();
      return created!;
    });
    return reply.status(201).send(toVariant(row));
  });

  app.put('/variants/:id', async (request): Promise<VariantDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(variantInputSchema, request.body);
    return scoped(request, async (tx) => {
      const [row] = await tx.update(serviceVariants).set(input).where(and(eq(serviceVariants.id, id), eq(serviceVariants.businessId, request.user.bid))).returning();
      if (!row) throw notFound();
      return toVariant(row);
    });
  });

  app.delete('/variants/:id', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    const deleted = await scoped(request, (tx) => tx.delete(serviceVariants).where(and(eq(serviceVariants.id, id), eq(serviceVariants.businessId, request.user.bid))).returning({ id: serviceVariants.id }));
    if (deleted.length === 0) throw notFound();
    return reply.status(204).send();
  });

  /* ---------- Paquetes ---------- */

  async function loadPackages(tx: Tx, businessId: string, onlyId?: string): Promise<PackageDto[]> {
    const rows = await tx
      .select()
      .from(servicePackages)
      .where(and(eq(servicePackages.businessId, businessId), onlyId ? eq(servicePackages.id, onlyId) : undefined))
      .orderBy(asc(servicePackages.sortOrder), asc(servicePackages.name));
    if (rows.length === 0) return [];
    const entries = await tx.select().from(servicePackageEntries).where(and(eq(servicePackageEntries.businessId, businessId), inArray(servicePackageEntries.packageId, rows.map((r) => r.id))));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      durationMinutes: row.durationMinutes,
      active: row.active,
      visibleOnWeb: row.visibleOnWeb,
      sortOrder: row.sortOrder,
      entries: entries.filter((e) => e.packageId === row.id).map((e) => ({ itemId: e.itemId, variantId: e.variantId })),
    }));
  }

  /** Cada servicio (y estilo) del paquete debe existir en ESTE negocio. */
  async function assertEntries(tx: Tx, businessId: string, entries: Array<{ itemId: string; variantId: string | null }>): Promise<void> {
    const itemIds = [...new Set(entries.map((e) => e.itemId.toLowerCase()))];
    const found = await tx.select({ id: items.id }).from(items).where(and(eq(items.businessId, businessId), eq(items.kind, 'service'), inArray(items.id, itemIds)));
    if (found.length !== itemIds.length) throw notFound();
    const variantEntries = entries.filter((e) => e.variantId);
    if (variantEntries.length > 0) {
      const variants = await tx.select({ id: serviceVariants.id, itemId: serviceVariants.itemId }).from(serviceVariants).where(and(eq(serviceVariants.businessId, businessId), inArray(serviceVariants.id, variantEntries.map((e) => e.variantId!.toLowerCase()))));
      for (const entry of variantEntries) if (!variants.some((v) => v.id === entry.variantId!.toLowerCase() && v.itemId === entry.itemId.toLowerCase())) throw notFound();
    }
  }

  app.get('/packages', async (request): Promise<PackageDto[]> => scoped(request, (tx) => loadPackages(tx, request.user.bid)));

  app.post('/packages', async (request, reply) => {
    const { entries, ...input } = parse(packageInputSchema, request.body);
    const dto = await scoped(request, async (tx) => {
      await assertEntries(tx, request.user.bid, entries);
      const [created] = await tx.insert(servicePackages).values({ businessId: request.user.bid, ...input }).returning();
      await tx.insert(servicePackageEntries).values(entries.map((e) => ({ businessId: request.user.bid, packageId: created!.id, itemId: e.itemId.toLowerCase(), variantId: e.variantId?.toLowerCase() ?? null })));
      return (await loadPackages(tx, request.user.bid, created!.id))[0]!;
    });
    return reply.status(201).send(dto);
  });

  app.put('/packages/:id', async (request): Promise<PackageDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const { entries, ...input } = parse(packageInputSchema, request.body);
    return scoped(request, async (tx) => {
      await assertEntries(tx, request.user.bid, entries);
      const [row] = await tx.update(servicePackages).set(input).where(and(eq(servicePackages.id, id), eq(servicePackages.businessId, request.user.bid))).returning();
      if (!row) throw notFound();
      await tx.delete(servicePackageEntries).where(and(eq(servicePackageEntries.packageId, id), eq(servicePackageEntries.businessId, request.user.bid)));
      await tx.insert(servicePackageEntries).values(entries.map((e) => ({ businessId: request.user.bid, packageId: id, itemId: e.itemId.toLowerCase(), variantId: e.variantId?.toLowerCase() ?? null })));
      return (await loadPackages(tx, request.user.bid, id))[0]!;
    });
  });

  app.delete('/packages/:id', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    const deleted = await scoped(request, (tx) => tx.delete(servicePackages).where(and(eq(servicePackages.id, id), eq(servicePackages.businessId, request.user.bid))).returning({ id: servicePackages.id }));
    if (deleted.length === 0) throw notFound();
    return reply.status(204).send();
  });
}

