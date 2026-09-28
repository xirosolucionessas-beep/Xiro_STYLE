import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, mergeConfig } from '../src/app';
import { hashToken } from '../src/booking/appointments';
import { loadConfig } from '../src/config';
import { WindowCounter } from '../src/security';
import type { Ctx } from '../src/context';
import { appointments } from '../src/db/schema';
import { cancelReminder, REMINDER_QUEUE, scheduleReminder, sendReminder, type ReminderJobData } from '../src/jobs/reminders';
import type { AppointmentReminderMessage, Notifier, OtpMessage } from '../src/notifier';
import { book, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Sustituto mínimo de pg-boss: solo lo que `scheduleReminder`/`cancelReminder` llaman. Guarda la `singletonKey` como
 * clave del "trabajo" para que `findJobs({ key })` se comporte como el filtro real. */
function fakeBoss() {
  let n = 0;
  const jobs = new Map<string, { id: string; key?: string; data: ReminderJobData; startAfter?: Date }>();
  return {
    jobs,
    send: vi.fn(async (_name: string, data: ReminderJobData, options: { startAfter?: Date; singletonKey?: string }) => {
      const id = `job${(n += 1)}`;
      jobs.set(id, { id, key: options.singletonKey, data, startAfter: options.startAfter });
      return id;
    }),
    findJobs: vi.fn(async (_name: string, options: { key: string }) => [...jobs.values()].filter((j) => j.key === options.key)),
    cancel: vi.fn(async (_name: string, ids: string | string[]) => {
      for (const id of [ids].flat()) jobs.delete(id);
    }),
  };
}

describe('scheduleReminder / cancelReminder (lógica pura, sin pg-boss real)', () => {
  it('programa con la cola, la clave y la hora correctas (unas horas antes de la cita)', async () => {
    const boss = fakeBoss();
    const startsAt = new Date(Date.now() + 24 * 3_600_000);
    await scheduleReminder(boss as never, 'biz-1', 'appt-1', startsAt);
    expect(boss.send).toHaveBeenCalledOnce();
    const [name, data, options] = boss.send.mock.calls[0]!;
    expect(name).toBe(REMINDER_QUEUE);
    expect(data).toEqual({ businessId: 'biz-1', appointmentId: 'appt-1' });
    expect(options.singletonKey).toBe('appt-1');
    expect((options.startAfter as Date).getTime()).toBe(startsAt.getTime() - 3 * 3_600_000);
  });

  it('reprogramar cancela primero el pendiente anterior: nunca quedan dos activos para la misma cita', async () => {
    const boss = fakeBoss();
    const soon = new Date(Date.now() + 24 * 3_600_000);
    await scheduleReminder(boss as never, 'biz-1', 'appt-1', soon);
    const later = new Date(Date.now() + 48 * 3_600_000);
    await scheduleReminder(boss as never, 'biz-1', 'appt-1', later);
    expect(boss.jobs.size).toBe(1);
    expect([...boss.jobs.values()][0]!.startAfter!.getTime()).toBe(later.getTime() - 3 * 3_600_000);
  });

  it('no programa nada si ya falta menos del margen de aviso (o la cita ya pasó)', async () => {
    const boss = fakeBoss();
    await scheduleReminder(boss as never, 'biz-1', 'appt-1', new Date(Date.now() + 3_600_000));
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('cancela los pendientes de esa cita y no falla si no había ninguno', async () => {
    const boss = fakeBoss();
    await scheduleReminder(boss as never, 'biz-1', 'appt-1', new Date(Date.now() + 24 * 3_600_000));
    await cancelReminder(boss as never, 'appt-1');
    expect(boss.jobs.size).toBe(0);
    await expect(cancelReminder(boss as never, 'appt-1')).resolves.toBeUndefined();
  });

  it('sin cola (boss null) ambas son no-op silenciosos', async () => {
    await expect(scheduleReminder(null, 'biz-1', 'appt-1', new Date())).resolves.toBeUndefined();
    await expect(cancelReminder(null, 'appt-1')).resolves.toBeUndefined();
  });
});

describe('sendReminder (el trabajo real, contra la base de pruebas)', () => {
  let app: FastifyInstance;
  let testDb: TestDatabase;
  let cleanupConfig: () => void;
  let ctx: Ctx;
  let reminders: AppointmentReminderMessage[];

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const { config, cleanup } = testAppConfig();
    cleanupConfig = cleanup;
    reminders = [];
    const notifier: Notifier = {
      sendOtp: async (_message: OtpMessage) => undefined,
      sendAppointmentReminder: async (message) => void reminders.push(message),
    };
    app = await buildApp({ db: testDb.db, config, notifier });
    ctx = { db: testDb.db, config: mergeConfig(loadConfig(), config), notifier, accountLimiter: new WindowCounter(60_000), bookingLimiter: new WindowCounter(60_000), boss: null, realtime: null, maps: null };
  });

  afterAll(async () => {
    await app.close();
    cleanupConfig();
    await testDb.drop();
  });

  async function bookAndFind(biz: Biz, over: Record<string, unknown> = {}) {
    const res = await book(app, biz, workday(3), '10:00', over);
    expect(res.statusCode).toBe(201);
    const { token } = res.json<{ token: string }>();
    const [row] = await testDb.db.select().from(appointments).where(eq(appointments.tokenHash, hashToken(token))).limit(1);
    return row!;
  }

  it('avisa por push al profesional aunque el cliente no haya aceptado recordatorios', async () => {
    const biz = await setupBiz(app, 'Sin recordatorio');
    const row = await bookAndFind(biz, { remindersOptIn: false });
    reminders.length = 0;
    await sendReminder(ctx, { businessId: biz.session.business.id, appointmentId: row.id });
    expect(reminders).toEqual([]); // no aceptó: nada al canal del cliente...
    // ...pero el push al profesional es de mejor esfuerzo y no lanza (sin credenciales de Expo/Web Push configuradas).
  });

  it('avisa también al cliente (por WhatsApp, tiene celular) cuando aceptó recordatorios al reservar', async () => {
    const biz = await setupBiz(app, 'Con recordatorio');
    const row = await bookAndFind(biz, { remindersOptIn: true });
    reminders.length = 0;
    await sendReminder(ctx, { businessId: biz.session.business.id, appointmentId: row.id });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ channel: 'whatsapp', clientName: 'Ana Pérez', businessName: biz.session.business.name });
  });

  it('no avisa nada si la cita ya se canceló antes de que llegara la hora del recordatorio', async () => {
    const biz = await setupBiz(app, 'Cancelada antes');
    const row = await bookAndFind(biz, { remindersOptIn: true });
    await testDb.db.update(appointments).set({ status: 'cancelled' }).where(eq(appointments.id, row.id));
    reminders.length = 0;
    await sendReminder(ctx, { businessId: biz.session.business.id, appointmentId: row.id });
    expect(reminders).toEqual([]);
  });
});
