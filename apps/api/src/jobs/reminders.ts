import { and, eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { clientNameOf } from '../booking/appointments';
import { loadContext } from '../booking/availability';
import { withBusinessTrusted } from '../booking/scope';
import type { Ctx } from '../context';
import { appointments, clients } from '../db/schema';
import { formatPushMoment, notifyAppointment } from '../push';

export const REMINDER_QUEUE = 'appointment-reminder';
/** Cuántas horas antes de la cita se avisa. Ni el negocio ni el cliente lo configuran hoy: es un valor fijo, razonable
 * para casi cualquier negocio de servicios (ver la ventana mínima de cancelación, que es aparte). */
const REMINDER_HOURS_BEFORE = 3;

export interface ReminderJobData {
  businessId: string;
  appointmentId: string;
}

/** Crea la cola si no existe. Se llama una vez al arrancar; repetirlo (p. ej. tras un redeploy) no hace nada. */
export async function ensureReminderQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(REMINDER_QUEUE);
}

/**
 * Programa (o reprograma) el recordatorio de una cita: si ya había uno pendiente lo cancela primero, así que crear,
 * mover o volver a llamar esto para la misma cita nunca deja dos recordatorios activos (la clave única es el id de la
 * cita). No programa nada si faltan menos de `REMINDER_HOURS_BEFORE` horas: ya no tendría margen de avisar antes.
 * Mejor esfuerzo, como el push de eventos: nunca debe tumbar la reserva que lo dispara.
 */
export async function scheduleReminder(boss: PgBoss | null, businessId: string, appointmentId: string, startsAt: Date): Promise<void> {
  if (!boss) return;
  await cancelReminder(boss, appointmentId);
  const remindAt = new Date(startsAt.getTime() - REMINDER_HOURS_BEFORE * 3_600_000);
  if (remindAt.getTime() <= Date.now()) return;
  try {
    const data: ReminderJobData = { businessId, appointmentId };
    await boss.send(REMINDER_QUEUE, data, { startAfter: remindAt, singletonKey: appointmentId });
  } catch {
    // Ver nota arriba: un fallo al programar no debe propagarse a quien reserva.
  }
}

/** Cancela el recordatorio pendiente de una cita (se movió, se canceló o se completó). No falla si ya no había uno. */
export async function cancelReminder(boss: PgBoss | null, appointmentId: string): Promise<void> {
  if (!boss) return;
  try {
    const pending = await boss.findJobs<ReminderJobData>(REMINDER_QUEUE, { key: appointmentId });
    if (pending.length > 0) await boss.cancel(REMINDER_QUEUE, pending.map((job) => job.id));
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
