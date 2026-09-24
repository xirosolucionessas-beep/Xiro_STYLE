import { lt } from 'drizzle-orm';
import type { Database } from './db/client';
import { otpCodes, refreshTokens, resetTokens } from './db/schema';

/** Borra tokens y códigos caducados para que las tablas de sesión no crezcan sin límite. */
export async function purgeExpired(db: Database, now = new Date()): Promise<{ refresh: number; otp: number; reset: number }> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [refresh, otp, reset] = await Promise.all([
    db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now)).returning({ id: refreshTokens.tokenHash }),
    db.delete(otpCodes).where(lt(otpCodes.expiresAt, dayAgo)).returning({ id: otpCodes.id }),
    db.delete(resetTokens).where(lt(resetTokens.expiresAt, now)).returning({ id: resetTokens.tokenHash }),
  ]);
  return { refresh: refresh.length, otp: otp.length, reset: reset.length };
}

/** Ejecuta la purga al arrancar y cada hora. El temporizador no impide que el proceso termine. */
export function scheduleMaintenance(db: Database, log: (message: string) => void): () => void {
  const run = () =>
    purgeExpired(db)
      .then((counts) => {
        if (counts.refresh + counts.otp + counts.reset > 0) log(`mantenimiento: eliminados ${JSON.stringify(counts)}`);
      })
      .catch((error) => log(`mantenimiento falló: ${(error as Error).message}`));
  void run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
