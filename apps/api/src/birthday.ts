import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  addDaysToDate,
  birthdayDiscount,
  birthdayWindowOn,
  BIRTHDAY_ISSUE_HOUR,
  DEFAULT_BIRTHDAY_PROGRAM,
  eligibleSubtotal,
  isLeapYear,
  localDateTimeIn,
  rewardState,
  type BirthdayProgramDto,
  type BirthdayProgramInput,
  type BirthdayRewardDto,
  type BirthdayRewardKind,
  type BirthdayScope,
  type BirthdayStatusDto,
} from '@xiro/shared';
import type { Ctx } from './context';
import type { DbExecutor } from './db/client';
import { birthdayPrograms, birthdayRewards, businesses, clients } from './db/schema';
import { AppError } from './errors';
import { notifyBusiness } from './push';

/**
 * Programa de cumpleaños (ver packages/shared/src/birthday.ts para las reglas). Todo va acotado por `business_id`; la
 * unicidad "una recompensa por negocio, cliente y año" la garantiza la base de datos (birthday_rewards_once_uq).
 */

type ProgramRow = typeof birthdayPrograms.$inferSelect;
type RewardRow = typeof birthdayRewards.$inferSelect;

const toProgramDto = (row: ProgramRow | undefined): BirthdayProgramDto =>
  row
    ? {
        enabled: row.enabled,
        rewardKind: row.rewardKind as BirthdayRewardKind,
        rewardValue: row.rewardValue,
        scope: row.scope as BirthdayScope,
        validDays: row.validDays,
        minTotal: row.minTotal,
        combinable: row.combinable,
        message: row.message,
        updatedAt: row.updatedAt.toISOString(),
      }
    : { ...DEFAULT_BIRTHDAY_PROGRAM, updatedAt: null };

export async function getBirthdayProgram(db: DbExecutor, businessId: string): Promise<BirthdayProgramDto> {
  const [row] = await db.select().from(birthdayPrograms).where(eq(birthdayPrograms.businessId, businessId)).limit(1);
  return toProgramDto(row);
}

export async function saveBirthdayProgram(db: DbExecutor, businessId: string, input: BirthdayProgramInput): Promise<BirthdayProgramDto> {
  const now = new Date();
  const [row] = await db
    .insert(birthdayPrograms)
    .values({ businessId, ...input, updatedAt: now })
    .onConflictDoUpdate({ target: birthdayPrograms.businessId, set: { ...input, updatedAt: now } })
    .returning();
  return toProgramDto(row);
}

export function toRewardDto(row: RewardRow, today: string): BirthdayRewardDto {
  return {
    id: row.id,
    year: row.year,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    state: rewardState(row, today),
    rewardKind: row.rewardKind as BirthdayRewardKind,
    rewardValue: row.rewardValue,
    scope: row.scope as BirthdayScope,
    minTotal: row.minTotal,
    combinable: row.combinable,
    amount: row.amount,
    usedAt: row.usedAt?.toISOString() ?? null,
  };
}

async function businessToday(db: DbExecutor, businessId: string, now: Date): Promise<string> {
  const [biz] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return localDateTimeIn(biz?.timezone ?? 'America/Bogota', now).date;
}

/**
 * Estado de cumpleaños de UN cliente del negocio: si el programa está activo, si tiene fecha (sin revelarla) y su recompensa
 * más reciente (la del año en curso, o la del año anterior si su vigencia cruza el año nuevo).
 */
export async function birthdayStatus(db: DbExecutor, businessId: string, clientId: string, now: Date = new Date()): Promise<BirthdayStatusDto> {
  const program = await getBirthdayProgram(db, businessId);
  const [client] = await db.select({ birthDate: clients.birthDate }).from(clients).where(and(eq(clients.id, clientId), eq(clients.businessId, businessId))).limit(1);
  if (!client) throw new AppError(404, 'not_found');
  const today = await businessToday(db, businessId, now);
  const year = Number(today.slice(0, 4));
  const [row] = await db
    .select()
    .from(birthdayRewards)
    .where(and(eq(birthdayRewards.businessId, businessId), eq(birthdayRewards.clientId, clientId), inArray(birthdayRewards.year, [year, year - 1])))
    .orderBy(desc(birthdayRewards.startsOn))
    .limit(1);
  // La del año anterior solo es relevante mientras dura su vigencia (o si se usó); si no, se muestra el año en curso vacío.
  const relevant = row && (row.year === year || today <= row.endsOn) ? row : undefined;
  return { programEnabled: program.enabled, hasBirthDate: client.birthDate !== null, message: program.message, reward: relevant ? toRewardDto(relevant, today) : null };
}

/* ---------- Emisión (trabajo diario) ---------- */

/** Días MM-DD cuyas fechas de nacimiento caen en la ventana [desde, hasta] (29 feb cuenta como 28 feb en años no bisiestos). */
function monthDays(from: string, to: string): string[] {
  const out = new Set<string>();
  for (let d = from; d <= to; d = addDaysToDate(d, 1)) {
    out.add(d.slice(5));
    if (d.slice(5) === '02-28' && !isLeapYear(Number(d.slice(0, 4)))) out.add('02-29');
  }
  return [...out];
}

export interface IssueResult {
  issued: number;
}

/**
 * Emite las recompensas que tocan HOY en cada negocio con el programa activo: cumpleaños de hoy (desde las 08:00 locales) y,
 * para recuperarse si el trabajo no corrió (caída, despliegue), cumpleaños de días anteriores cuya vigencia sigue abierta.
 * Idempotente: `ON CONFLICT DO NOTHING` sobre (negocio, cliente, año), así que reintentos, ejecuciones simultáneas o varias
 * instancias nunca emiten dos. El aviso al negocio sale solo por las filas realmente insertadas, con clave de deduplicación.
 */
export async function issueDueBirthdayRewards(ctx: Pick<Ctx, 'db' | 'config'>, now: Date = new Date()): Promise<IssueResult> {
  const { db } = ctx;
  const programs = await db
    .select({ program: birthdayPrograms, timezone: businesses.timezone, accessStatus: businesses.accessStatus })
    .from(birthdayPrograms)
    .innerJoin(businesses, eq(businesses.id, birthdayPrograms.businessId))
    .where(eq(birthdayPrograms.enabled, true));
  let issued = 0;
  for (const { program, timezone, accessStatus } of programs) {
    if (accessStatus !== 'active') continue; // negocio suspendido o dado de baja: no se emite nada
    const { date: today, hour } = localDateTimeIn(timezone, now);
    const latest = hour >= BIRTHDAY_ISSUE_HOUR ? today : addDaysToDate(today, -1);
    const earliest = addDaysToDate(today, -(program.validDays - 1));
    if (latest < earliest) continue;
    const candidates = await db
      .select({ id: clients.id, name: clients.name, birthDate: clients.birthDate })
      .from(clients)
      .where(and(eq(clients.businessId, program.businessId), isNotNull(clients.birthDate), eq(clients.isOccasional, false), inArray(sql<string>`to_char(${clients.birthDate}, 'MM-DD')`, monthDays(earliest, latest))));
    for (const client of candidates) {
      const window = birthdayWindowOn(client.birthDate!, today, program.validDays);
      if (!window || window.birthdayOn > latest) continue; // hoy antes de las 08:00, o fuera de la ventana
      const [created] = await db
        .insert(birthdayRewards)
        .values({
          businessId: program.businessId,
          clientId: client.id,
          year: window.year,
          startsOn: window.birthdayOn,
          endsOn: window.endsOn,
          rewardKind: program.rewardKind,
          rewardValue: program.rewardValue,
          scope: program.scope,
          minTotal: program.minTotal,
          combinable: program.combinable,
        })
        .onConflictDoNothing({ target: [birthdayRewards.businessId, birthdayRewards.clientId, birthdayRewards.year] })
        .returning({ id: birthdayRewards.id });
      if (!created) continue;
      issued += 1;
      const [y, m, d] = window.endsOn.split('-');
      // Aviso interno al negocio: nombre del cliente (para reconocerlo) y vigencia; nunca la fecha de nacimiento ni la edad.
      await notifyBusiness(ctx, program.businessId, 'clients', {
        titleKey: 'push_birthday_title',
        bodyKey: 'push_birthday_body',
        params: { name: client.name, date: `${d}/${m}/${y}` },
        dedupeKey: `birthday:${created.id}`,
        href: `/client/${client.id}`,
      });
    }
  }
  return { issued };
}

/* ---------- Canje ---------- */

export interface ReservedReward {
  id: string;
  amount: number;
}

/**
 * Bloquea (FOR UPDATE) y valida la recompensa del cliente para usarla en una compra de ESTA transacción, y calcula el
 * descuento con las condiciones congeladas. No la marca todavía: quien llama crea la venta/cita/pedido y luego llama a
 * `markBirthdayRewardUsed` (la fila sigue bloqueada, así que otra petición simultánea espera y después la ve usada).
 */
export async function reserveBirthdayReward(
  tx: DbExecutor,
  input: { businessId: string; clientId: string; rewardId?: string; lines: Array<{ kind: 'service' | 'product' | 'package'; total: number }>; otherDiscount: number; now?: Date },
): Promise<ReservedReward> {
  const now = input.now ?? new Date();
  const program = await getBirthdayProgram(tx, input.businessId);
  if (!program.enabled) throw new AppError(409, 'birthday_reward_unavailable');
  const today = await businessToday(tx, input.businessId, now);
  const year = Number(today.slice(0, 4));
  const conditions = [eq(birthdayRewards.businessId, input.businessId), eq(birthdayRewards.clientId, input.clientId)];
  conditions.push(input.rewardId ? eq(birthdayRewards.id, input.rewardId) : inArray(birthdayRewards.year, [year, year - 1]));
  const [row] = await tx.select().from(birthdayRewards).where(and(...conditions)).orderBy(desc(birthdayRewards.startsOn)).limit(1).for('update');
  if (!row || rewardState(row, today) !== 'available' || today < row.startsOn) throw new AppError(409, 'birthday_reward_unavailable');
  if (!row.combinable && input.otherDiscount > 0) throw new AppError(409, 'birthday_not_combinable');
  const amount = birthdayDiscount(eligibleSubtotal(input.lines, row.scope as BirthdayScope), { rewardKind: row.rewardKind as BirthdayRewardKind, rewardValue: row.rewardValue, minTotal: row.minTotal });
  if (amount === 0) throw new AppError(409, 'birthday_min_total', undefined, undefined, { minTotal: row.minTotal });
  // Junto a otro descuento (código o descuento manual) nunca deja el total por debajo de 0: se usa solo lo que queda por pagar.
  const left = Math.max(0, input.lines.reduce((sum, l) => sum + l.total, 0) - input.otherDiscount);
  if (left === 0) throw new AppError(409, 'birthday_nothing_left');
  return { id: row.id, amount: Math.min(amount, left) };
}

export async function markBirthdayRewardUsed(
  tx: DbExecutor,
  businessId: string,
  reserved: ReservedReward,
  target: { saleId: string } | { appointmentId: string } | { productOrderId: string },
  now: Date = new Date(),
): Promise<void> {
  const status = 'saleId' in target ? 'redeemed' : 'claimed';
  const [updated] = await tx
    .update(birthdayRewards)
    .set({ status, amount: reserved.amount, usedAt: now, ...target })
    .where(and(eq(birthdayRewards.id, reserved.id), eq(birthdayRewards.businessId, businessId), eq(birthdayRewards.status, 'available')))
    .returning({ id: birthdayRewards.id });
  if (!updated) throw new AppError(409, 'birthday_reward_unavailable');
}

/**
 * La venta se anuló o la reserva/pedido se canceló: la recompensa vuelve a estar disponible (si su vigencia ya pasó, se verá
 * vencida). Sigue siendo la MISMA fila del año: nunca habilita una segunda.
 */
export async function releaseBirthdayReward(tx: DbExecutor, businessId: string, target: { saleId: string } | { appointmentId: string } | { productOrderId: string }): Promise<void> {
  const column = 'saleId' in target ? birthdayRewards.saleId : 'appointmentId' in target ? birthdayRewards.appointmentId : birthdayRewards.productOrderId;
  const value = 'saleId' in target ? target.saleId : 'appointmentId' in target ? target.appointmentId : target.productOrderId;
  await tx
    .update(birthdayRewards)
    .set({ status: 'available', amount: null, usedAt: null, saleId: null, appointmentId: null, productOrderId: null })
    .where(and(eq(birthdayRewards.businessId, businessId), eq(column, value)));
}



/** Citas o pedidos (de esta lista) cuyo descuento incluye la recompensa de cumpleaños: para rotularlo como tal. */
export async function birthdayTargetIds(tx: DbExecutor, businessId: string, kind: 'appointment' | 'order', ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const column = kind === 'appointment' ? birthdayRewards.appointmentId : birthdayRewards.productOrderId;
  const rows = await tx.select({ id: column }).from(birthdayRewards).where(and(eq(birthdayRewards.businessId, businessId), eq(birthdayRewards.status, 'claimed'), inArray(column, ids)));
  return new Set(rows.map((r) => r.id).filter((id): id is string => id !== null));
}
