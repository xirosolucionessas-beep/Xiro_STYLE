import { and, eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { clientNameOf } from '../booking/appointments';
import { loadContext } from '../booking/availability';
import { withBusinessTrusted } from '../booking/scope';
import type { Ctx } from '../context';
import { appointments, businessSettings, clients } from '../db/schema';
import type { Database } from '../db/client';
import { REMINDER_HOUR_OPTIONS } from '@xiro/shared';
import { formatPushMoment, notifyAppointment } from '../push';

export const REMINDER_QUEUE = 'appointment-reminder';
/** Recordatorio de siempre (3 h antes) si el negocio no eligió otros. Desde la Fase 4 cada negocio elige hasta 3 (`reminderHours`). */
const DEFAULT_REMINDER_HOURS = [3];

export interface ReminderJobData {
  businessId: string;
  appointmentId: string;
  /** Con cuántas horas de anticipación es este aviso (los programados antes de la Fase 4 no lo traen: eran de 3 h). */
  hoursBefore?: number;
}

/** Clave única de cada aviso de una cita: una por anticipación, así nunca hay dos iguales activos. */
const reminderKey = (appointmentId: string, hours: number) => `${appointmentId}:${hours}`;

/** Crea la cola si no existe. Se llama una vez al arrancar; repetirlo (p. ej. tras un redeploy) no hace nada. */
export async function ensureReminderQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(REMINDER_QUEUE);
}

/**
 * Programa (o reprograma) los recordatorios de una cita, uno por cada anticipación de `hours` (p. ej. [24, 2]): primero cancela
 * los pendientes, así que crear, mover o volver a llamar esto nunca deja avisos duplicados. Un aviso cuya hora ya pasó (la
 * cita está más cerca que esa anticipación) no se programa. Mejor esfuerzo: nunca debe tumbar la reserva que lo dispara.
 */
export async function scheduleReminder(boss: PgBoss | null, businessId: string, appointmentId: string, startsAt: Date, hours: readonly number[] = DEFAULT_REMINDER_HOURS): Promise<void> {
  if (!boss) return;
  await cancelReminder(boss, appointmentId);
  for (const hoursBefore of new Set(hours)) {
    const remindAt = new Date(startsAt.getTime() - hoursBefore * 3_600_000);
    if (remindAt.getTime() <= Date.now()) continue;
    try {
      const data: ReminderJobData = { businessId, appointmentId, hoursBefore };
      await boss.send(REMINDER_QUEUE, data, { startAfter: remindAt, singletonKey: reminderKey(appointmentId, hoursBefore) });
    } catch {
      // Ver nota arriba: un fallo al programar no debe propagarse a quien reserva.
    }
  }
}

/** Las anticipaciones que eligió el negocio (Fase 4); sin configuración, el recordatorio de siempre. */
export async function reminderHoursOf(db: Database, businessId: string): Promise<number[]> {
  const [row] = await db.select({ hours: businessSettings.reminderHours }).from(businessSettings).where(eq(businessSettings.businessId, businessId)).limit(1);
  return row?.hours ?? DEFAULT_REMINDER_HOURS;
}

/** Programa los recordatorios de una cita con las anticipaciones del negocio. Mejor esfuerzo (nunca lanza). */
export async function scheduleAppointmentReminders(ctx: { boss: PgBoss | null; db: Database }, businessId: string, appointmentId: string, startsAt: Date): Promise<void> {
  if (!ctx.boss) return;
  const hours = await reminderHoursOf(ctx.db, businessId).catch(() => DEFAULT_REMINDER_HOURS);
  await scheduleReminder(ctx.boss, businessId, appointmentId, startsAt, hours);
}

/**
 * Cancela TODOS los recordatorios pendientes de una cita (se movió, se canceló o se completó): los de cada anticipación y el
 * de la versión anterior (clave = id de la cita, programado antes de la Fase 4). No falla si ya no había ninguno.
 */
export async function cancelReminder(boss: PgBoss | null, appointmentId: string): Promise<void> {
  if (!boss) return;
  try {
    for (const key of [appointmentId, ...REMINDER_HOUR_OPTIONS.map((h) => reminderKey(appointmentId, h))]) {
      const pending = await boss.findJobs<ReminderJobData>(REMINDER_QUEUE, { key });
      if (pending.length > 0) await boss.cancel(REMINDER_QUEUE, pending.map((job) => job.id));
    }
  } catch {
    // Ver nota en scheduleReminder.
  }
}

/**
 * El trabajo real: por cada recordatorio vencido, avisa al profesional por push (siempre — ya funciona sin
 * credenciales nuevas) y al cliente por el canal disponible SOLO si aceptó recordatorios al reservar (`remindersOptIn`,
 * el consentimiento de Ley 1581 es específico para contactarlo, no para avisar al equipo). El canal del cliente está
 * detrás de `ctx.notifier`, que hoy es `ConsoleNotifier` — pendiente de credenciales de Resend/WhatsApp Cloud API.
 * Un error de un recordatorio nunca debe tumbar los demás del mismo lote.
 */
export function registerReminderWorker(boss: PgBoss, ctx: Ctx, log: (line: string) => void = console.error): Promise<string> {
  return boss.work<ReminderJobData>(REMINDER_QUEUE, async (jobs: Array<{ data: ReminderJobData }>) => {
    for (const job of jobs) {
      // Un recordatorio que falla (negocio borrado, error transitorio de red al canal del cliente…) no debe reintentar
      // para siempre ni tumbar los demás del lote: se registra y se sigue.
      await sendReminder(ctx, job.data).catch((error: unknown) => log(`[recordatorio] falló cita=${job.data.appointmentId}: ${(error as Error).message}`));
    }
  });
}

/** Exportado solo para la prueba de integración; el flujo real pasa por `registerReminderWorker`. */
export async function sendReminder(ctx: Ctx, data: ReminderJobData): Promise<void> {
  await withBusinessTrusted(ctx.db, data.businessId, async (tx) => {
    const [row] = await tx.select().from(appointments).where(and(eq(appointments.id, data.appointmentId), eq(appointments.businessId, data.businessId))).limit(1);
    // Se canceló, ya pasó o se completó entre que se programó el recordatorio y que llegó su hora: no hay nada que avisar.
    if (!row || (row.status !== 'pending' && row.status !== 'confirmed')) return;

    const context = await loadContext(tx, data.businessId);
    void notifyAppointment(ctx, data.businessId, row.professionalId, null, 'appointments', {
      titleKey: 'push_appt_reminder_title',
      bodyKey: 'push_appt_reminder_body',
      params: { time: formatPushMoment(row.startsAt.toISOString(), context.business.timezone) },
      // Un aviso por anticipación (24 h y 2 h son dos notificaciones distintas); los antiguos conservan su clave.
      dedupeKey: data.hoursBefore ? `appt_reminder:${row.id}:${data.hoursBefore}` : `appt_reminder:${row.id}`,
      href: '/agenda',
    });

    if (!row.remindersOptIn) return;
    const [client] = await tx.select({ phone: clients.phone, email: clients.email }).from(clients).where(and(eq(clients.id, row.clientId), eq(clients.businessId, data.businessId))).limit(1);
    const channel: 'whatsapp' | 'email' | null = client?.phone ? 'whatsapp' : client?.email ? 'email' : null;
    if (!channel) return;
    const clientName = await clientNameOf(tx, data.businessId, row.clientId);
    await ctx.notifier.sendAppointmentReminder({
      channel,
      to: (channel === 'whatsapp' ? client!.phone : client!.email)!,
      clientName,
      businessName: context.business.name,
      when: formatPushMoment(row.startsAt.toISOString(), context.business.timezone),
    });
  });
}
