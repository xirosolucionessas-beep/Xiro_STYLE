import { sql } from 'drizzle-orm';
import type { Tx } from './scope';

/**
 * Candado de la CAJA de un negocio y un día (concurrencia entre el cierre y lo que el cierre cuenta).
 *
 * El cierre calcula el resumen del día y lo firma en una transacción; ventas y gastos comprueban por su cuenta si el día
 * está cerrado y luego escriben. Sin coordinación, según el orden de confirmación, el cierre firmado podía no incluir una
 * operación que confirmó "en medio" (o una operación aceptaba un día que se estaba cerrando). Ver test/cashConcurrency.test.ts.
 *
 * Solución: un advisory lock de PostgreSQL por (negocio, día), con alcance de TRANSACCIÓN (se libera solo al confirmar o
 * revertir, también si algo falla):
 *  - Ventas y gastos lo toman COMPARTIDO: no se bloquean entre ellos (el ritmo normal de trabajo no cambia).
 *  - El cierre lo toma EXCLUSIVO: espera a que terminen las operaciones en curso de ese día y las que llegan mientras tanto
 *    esperan a que confirme; al seguir, ya ven el cierre y aplican sus reglas (409, ajuste, "después del cierre"…).
 * Sin interbloqueos: el cierre toma un solo candado y quien toma varios días los toma en orden ascendente.
 * DEBE tomarse al principio de la transacción, ANTES de comprobar si el día está cerrado.
 */
export type CashLockMode = 'shared' | 'exclusive';

export async function lockCashDays(tx: Tx, businessId: string, days: Array<string | null | undefined>, mode: CashLockMode): Promise<void> {
  const unique = [...new Set(days.filter((d): d is string => Boolean(d)))].sort();
  for (const day of unique) {
    const key = `cash-day:${businessId.toLowerCase()}:${day}`;
    if (mode === 'exclusive') await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    else await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`);
  }
}

/**
 * Candado COMPARTIDO del día local en que cae `instant` (por defecto, ahora según el reloj de la base: el mismo `now()` con
 * que se guarda el `created_at` de la venta). El día se calcula en la base con la zona horaria del negocio.
 */
export async function lockCashDayAt(tx: Tx, businessId: string, instant?: Date): Promise<string> {
  const at = instant ? sql`${instant.toISOString()}::timestamptz` : sql`now()`;
  const result = await tx.execute<{ day: string }>(sql`select to_char(${at} at time zone b.timezone, 'YYYY-MM-DD') as day from businesses b where b.id = ${businessId}`);
  const day = result.rows[0]?.day;
  if (!day) throw new Error('business not found for cash lock');
  await lockCashDays(tx, businessId, [String(day)], 'shared');
  return String(day);
}
