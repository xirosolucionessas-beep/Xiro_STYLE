import { bookingSettingsInputSchema, OCCUPYING_STATUSES, type AvailabilitySlot, type BookingSelection, type BookingSettings } from '@xiro/shared';
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { AppError } from '../errors';
import { appointments, businessClosures, businessSettings, businesses, employeeTimeOff } from '../db/schema';
import type { BusinessRow } from '../serializers';
import { businessHoursSchema, defaultBusinessHours } from '@xiro/shared';
import { eligibleProfessionals, priceFor, resolveSelection, type EligibleProfessional, type ResolvedSelection } from './catalog';
import type { Tx } from './scope';
import { blocksForDate, blocksFromBusinessHours, computeSlots, gridMinutes, professionalState, type Block, type DayInput, type Interval, type ProfessionalDay, type SlotDetail } from './slots';
import { addDays, isRealDate, localDate, localMinutes, zonedInstant } from './time';

export interface BookingContext {
  business: BusinessRow;
  settings: BookingSettings;
  /** Horario semanal del negocio (bloques). */
  weekly: Array<{ weekday: number; from: string; to: string }>;
  closures: Set<string>;
}

/** Negocio + reglas de reservas (con valores por defecto si nunca las configuró) + horario semanal + días cerrados. */
export async function loadContext(tx: Tx, businessId: string): Promise<BookingContext> {
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) throw new AppError(404, 'not_found');
  const [row] = await tx.select().from(businessSettings).where(eq(businessSettings.businessId, businessId)).limit(1);
  const settings: BookingSettings = row
    ? {
        slotIntervalMinutes: row.slotIntervalMinutes as BookingSettings['slotIntervalMinutes'],
        minNoticeMinutes: row.minNoticeMinutes,
        maxDaysAhead: row.maxDaysAhead,
        cancelUntilHours: row.cancelUntilHours,
        maxModifications: row.maxModifications,
        autoConfirm: row.autoConfirm,
        requireEmail: row.requireEmail,
        maxPendingPerPhone: row.maxPendingPerPhone,
        hoursBlocks: row.hoursBlocks ?? null,
        customFields: row.customFields,
        hideOutOfStockInCatalog: row.hideOutOfStockInCatalog,
      }
    : bookingSettingsInputSchema.parse({});
  const parsedHours = businessHoursSchema.safeParse(business.hours);
  const weekly = settings.hoursBlocks ?? blocksFromBusinessHours(parsedHours.success ? parsedHours.data : defaultBusinessHours());
  const closureRows = await tx.select({ date: businessClosures.date }).from(businessClosures).where(eq(businessClosures.businessId, businessId));
  return { business, settings, weekly, closures: new Set(closureRows.map((c) => c.date)) };
}

export interface Prepared {
  ctx: BookingContext;
  resolved: ResolvedSelection;
  /** Profesionales que pueden hacer TODO lo elegido (ya filtrados si se eligió uno en particular). */
  pros: EligibleProfessional[];
  /** El personal puede agendar dentro de la anticipación mínima y más allá del horizonte público. */
  staff: boolean;
}

/**
 * Valida lo elegido contra el negocio y reúne a los profesionales aptos. `professionalId` = 'any' o un id concreto:
 * un id que no pertenece a este negocio (o no atiende eso) responde igual que uno inexistente.
 */
export async function prepare(tx: Tx, businessId: string, options: { selection: BookingSelection; professionalId: string; staff: boolean; ctx?: BookingContext }): Promise<Prepared> {
  const ctx = options.ctx ?? (await loadContext(tx, businessId));
  const resolved = await resolveSelection(tx, businessId, options.selection, { publicOnly: !options.staff });
  let pros = await eligibleProfessionals(tx, businessId, resolved.serviceItemIds, { publicOnly: !options.staff });
  if (options.professionalId !== 'any') {
    pros = pros.filter((p) => p.id === options.professionalId.toLowerCase());
    if (pros.length === 0) throw new AppError(400, 'professional_unavailable');
  }
  return { ctx, resolved, pros, staff: options.staff };
}

interface RangeData {
  busy: Map<string, Interval[]>;
  timeOff: Map<string, Interval[]>;
}

/** Citas activas y ausencias de los profesionales en un rango de instantes (una sola consulta para varios días). */
async function loadRange(tx: Tx, businessId: string, professionalIds: string[], from: Date, to: Date, excludeAppointmentId?: string): Promise<RangeData> {
  const busy = new Map<string, Interval[]>();
  const timeOff = new Map<string, Interval[]>();
  if (professionalIds.length === 0) return { busy, timeOff };
  const taken = await tx
    .select({ professionalId: appointments.professionalId, start: appointments.startsAt, end: appointments.busyUntil })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        inArray(appointments.professionalId, professionalIds),
        inArray(appointments.status, [...OCCUPYING_STATUSES]),
        lt(appointments.startsAt, to),
        gt(appointments.busyUntil, from),
        excludeAppointmentId ? ne(appointments.id, excludeAppointmentId) : undefined,
      ),
    );
  for (const row of taken) busy.set(row.professionalId, [...(busy.get(row.professionalId) ?? []), { start: row.start, end: row.end }]);
  const off = await tx
    .select({ userId: employeeTimeOff.userId, start: employeeTimeOff.startsAt, end: employeeTimeOff.endsAt })
    .from(employeeTimeOff)
    .where(and(eq(employeeTimeOff.businessId, businessId), inArray(employeeTimeOff.userId, professionalIds), lt(employeeTimeOff.startsAt, to), gt(employeeTimeOff.endsAt, from)));
  for (const row of off) timeOff.set(row.userId, [...(timeOff.get(row.userId) ?? []), { start: row.start, end: row.end }]);
  return { busy, timeOff };
}

const rangeOf = (ctx: BookingContext, fromDate: string, days: number) => ({
  from: zonedInstant(fromDate, 0, ctx.business.timezone),
  to: zonedInstant(addDays(fromDate, days), 0, ctx.business.timezone),
});

function dayInput(p: Prepared, date: string, now: Date, pro: EligibleProfessional, range: RangeData): DayInput {
  const { ctx } = p;
  const priced = priceFor(p.resolved, pro);
  const proDay: ProfessionalDay = {
    id: pro.id,
    blocks: pro.schedule ? blocksForDate(pro.schedule, date) : null,
    timeOff: range.timeOff.get(pro.id) ?? [],
    busy: range.busy.get(pro.id) ?? [],
  };
  return {
    timezone: ctx.business.timezone,
    date,
    now,
    intervalMinutes: ctx.settings.slotIntervalMinutes,
    minNoticeMinutes: ctx.settings.minNoticeMinutes,
    lastBookableDate: addDays(localDate(now, ctx.business.timezone), ctx.settings.maxDaysAhead),
    serviceMinutes: priced.minutes,
    cleanupMinutes: priced.cleanup,
    businessBlocks: blocksForDate(ctx.weekly, date),
    closed: ctx.closures.has(date),
    professionals: [proDay],
    ignoreNoticeAndHorizon: p.staff,
  };
}

export interface DayResult {
  date: string;
  /** El negocio (y al menos un profesional apto) trabaja ese día. */
  open: boolean;
  totalMinutes: number;
  slots: SlotDetail[];
}

const totalMinutesOf = (p: Prepared): number => {
  const priced = p.pros.map((pro) => priceFor(p.resolved, pro));
  const source = priced.length > 0 ? priced : [priceFor(p.resolved, { overrides: new Map() })];
  return Math.max(...source.map((x) => x.minutes + x.cleanup));
};

function computeDay(p: Prepared, date: string, now: Date, range: RangeData): DayResult {
  const businessBlocks = blocksForDate(p.ctx.weekly, date);
  const closed = p.ctx.closures.has(date);
  const working = p.pros.filter((pro) => !pro.schedule || blocksForDate(pro.schedule, date).length > 0);
  const open = businessBlocks.length > 0 && !closed && working.length > 0;
  const totalMinutes = totalMinutesOf(p);
  if (businessBlocks.length === 0) return { date, open, totalMinutes, slots: [] };

  // Cada profesional se evalúa con SU duración y precio (pueden tener ajustes propios); luego se combinan por horario.
  const perPro = p.pros.map((pro) => computeSlots(dayInput(p, date, now, pro, range)));
  const base = perPro[0] ?? computeSlots({ ...dayInput(p, date, now, { id: '-', name: '', publicName: '', sortOrder: 0, isOwner: false, schedule: null, overrides: new Map() }, range), professionals: [] });
  const slots = base.map((slot, index) => {
    const each = perPro.map((list) => list[index]!);
    const free = each.filter((s) => s.state === 'available').flatMap((s) => s.availableProfessionalIds);
    const state = free.length > 0 ? 'available' : each.some((s) => s.state === 'booked') ? 'booked' : 'unavailable';
    return { time: slot.time, startsAt: slot.startsAt, state, availableProfessionalIds: free } satisfies SlotDetail;
  });
  return { date, open, totalMinutes, slots };
}

/** Disponibilidad de `days` días seguidos desde `fromDate` (fecha local del negocio). */
export async function slotsForDays(tx: Tx, businessId: string, p: Prepared, now: Date, fromDate: string, days: number, excludeAppointmentId?: string): Promise<DayResult[]> {
  if (!isRealDate(fromDate)) throw new AppError(400, 'date_invalid');
  const { from, to } = rangeOf(p.ctx, fromDate, days);
  const range = await loadRange(tx, businessId, p.pros.map((pro) => pro.id), from, to, excludeAppointmentId);
  return Array.from({ length: days }, (_, offset) => computeDay(p, addDays(fromDate, offset), now, range));
}

/** Lo único que sale a la página pública de cada horario: hora, instante y estado. Nunca quién lo ocupa. */
export const toPublicSlot = (slot: SlotDetail): AvailabilitySlot => ({ time: slot.time, startsAt: slot.startsAt, state: slot.state });

export interface StartEvaluation {
  /** Profesionales libres para ese inicio exacto. */
  freeProfessionals: EligibleProfessional[];
  /** El inicio cae en la cuadrícula de horarios del negocio (obligatorio en la página pública). */
  onGrid: boolean;
  /** Cuántas citas tiene cada profesional ese día (para repartir el trabajo en "Primero disponible"). */
  load: Map<string, number>;
  /** Minutos totales (servicio) y de limpieza para cada profesional libre. */
  priced: Map<string, { minutes: number; cleanup: number; total: number }>;
}

/** Evalúa un inicio concreto contra los profesionales aptos (revalidación dentro de la transacción de la reserva). */
export async function evaluateStart(tx: Tx, businessId: string, p: Prepared, now: Date, startsAt: Date, excludeAppointmentId?: string): Promise<StartEvaluation> {
  const tz = p.ctx.business.timezone;
  const date = localDate(startsAt, tz);
  const minutes = localMinutes(startsAt, tz);
  const { from, to } = rangeOf(p.ctx, date, 1);
  const range = await loadRange(tx, businessId, p.pros.map((pro) => pro.id), from, to, excludeAppointmentId);
  const blocks: Block[] = blocksForDate(p.ctx.weekly, date);
  const onGrid = startsAt.getUTCSeconds() === 0 && gridMinutes(blocks, p.ctx.settings.slotIntervalMinutes).includes(minutes);
  const free: EligibleProfessional[] = [];
  const priced = new Map<string, { minutes: number; cleanup: number; total: number }>();
  const load = new Map<string, number>();
  for (const pro of p.pros) {
    const input = dayInput(p, date, now, pro, range);
    load.set(pro.id, (range.busy.get(pro.id) ?? []).filter((i) => i.start >= from && i.start < to).length);
    if (professionalState(input, input.professionals[0]!, minutes) === 'available') {
      free.push(pro);
      const price = priceFor(p.resolved, pro);
      priced.set(pro.id, { minutes: price.minutes, cleanup: price.cleanup, total: price.total });
    }
  }
  return { freeProfessionals: free, onGrid, load, priced };
}

/** Profesionales libres por orden de preferencia: primero el que menos citas tiene ese día, y a igualdad el orden del equipo. */
export function orderedCandidates(evaluation: StartEvaluation): EligibleProfessional[] {
  return [...evaluation.freeProfessionals].sort((x, y) => (evaluation.load.get(x.id) ?? 0) - (evaluation.load.get(y.id) ?? 0) || x.sortOrder - y.sortOrder);
}

/** Elige a quién atiende cuando el cliente dijo "Primero disponible". */
export const pickProfessional = (evaluation: StartEvaluation): EligibleProfessional | null => orderedCandidates(evaluation)[0] ?? null;

/** Horarios libres más cercanos al pedido (mismo día primero, luego los siguientes) para ofrecer cuando `slot_taken`. */
export async function alternativesAround(tx: Tx, businessId: string, p: Prepared, now: Date, startsAt: Date, limit = 6, excludeAppointmentId?: string): Promise<AvailabilitySlot[]> {
  const tz = p.ctx.business.timezone;
  const date = localDate(startsAt, tz);
  const target = localMinutes(startsAt, tz);
  const days = await slotsForDays(tx, businessId, p, now, date, 7, excludeAppointmentId);
  const minutesOf = (slot: SlotDetail) => Number(slot.time.slice(0, 2)) * 60 + Number(slot.time.slice(3));
  const out: AvailabilitySlot[] = [];
  days.forEach((day, index) => {
    const free = day.slots.filter((s) => s.state === 'available');
    const ordered = index === 0 ? [...free].sort((a, b) => Math.abs(minutesOf(a) - target) - Math.abs(minutesOf(b) - target)).slice(0, 3).sort((a, b) => a.time.localeCompare(b.time)) : free.slice(0, 2);
    for (const slot of ordered) if (out.length < limit && slot.startsAt !== startsAt.toISOString()) out.push(toPublicSlot(slot));
  });
  return out;
}
