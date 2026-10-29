import type { PgBoss } from 'pg-boss';
import { issueDueBirthdayRewards } from '../birthday';
import type { Ctx } from '../context';

/**
 * Programa de cumpleaños: un trabajo programado de pg-boss (mismo mecanismo que los recordatorios de citas). Corre cada hora
 * en el minuto 5: así cada negocio recibe su aviso poco después de las 08:00 en SU zona horaria, y si una ejecución falla la
 * siguiente se pone al día. pg-boss ejecuta cada tick UNA sola vez aunque haya varias instancias; y aunque corriera dos
 * veces, la restricción única de la base impide emitir (y avisar) dos veces.
 */
export const BIRTHDAY_QUEUE = 'birthday-rewards';
export const BIRTHDAY_CRON = '5 * * * *';

export async function ensureBirthdaySchedule(boss: PgBoss): Promise<void> {
  await boss.createQueue(BIRTHDAY_QUEUE);
  await boss.schedule(BIRTHDAY_QUEUE, BIRTHDAY_CRON, null, { tz: 'UTC' });
}

export function registerBirthdayWorker(boss: PgBoss, ctx: Ctx, log: (line: string) => void = console.error): Promise<string> {
  return boss.work(BIRTHDAY_QUEUE, async () => {
    const result = await issueDueBirthdayRewards(ctx).catch((error: unknown) => {
      log(`[cumpleaños] falló la emisión: ${(error as Error).message}`);
      throw error; // pg-boss lo marca fallido; la próxima hora se reintenta y se pone al día
    });
    if (result.issued > 0) log(`[cumpleaños] recompensas emitidas: ${result.issued}`);
  });
}
