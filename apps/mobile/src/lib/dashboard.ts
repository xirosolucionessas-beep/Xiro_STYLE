import type { Item } from '@xiro/shared';
import { dayKey } from './homeMetrics';

/**
 * Cálculos del tablero de Inicio (web) con datos que la app YA tiene: servicios registrados, clientes e inventario.
 * No hay módulo de ventas ni de citas todavía, así que "ventas" = lo cobrado en los servicios registrados. Todo es puro.
 */

export type TrendDirection = 'up' | 'down' | 'flat' | 'none';
export interface Trend {
  direction: TrendDirection;
  /** Porcentaje redondeado; `null` si no se puede calcular (ayer fue 0). */
  percent: number | null;
  delta: number;
}

/** Cambio de hoy frente a ayer. Sin base de comparación (ayer 0 y hoy > 0) sube sin porcentaje: no se inventa "+∞%". */
export function variation(current: number, previous: number): Trend {
  if (current === 0 && previous === 0) return { direction: 'flat', percent: 0, delta: 0 };
  if (previous === 0) return { direction: current > 0 ? 'up' : 'none', percent: null, delta: current };
  const delta = current - previous;
  return { direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', percent: Math.round((delta / previous) * 100), delta };
}

const DAY_MS = 86_400_000;

export interface DayTotals {
  total: number;
  count: number;
}

/** Ventas y cantidad de servicios de hoy y de ayer, según el día del negocio (su zona horaria). */
export function serviceDays(records: ReadonlyArray<{ amount: number; createdAt: string }>, timezone: string, now: Date = new Date()): { today: DayTotals; yesterday: DayTotals } {
  const todayKey = dayKey(timezone, now);
  const yesterdayKey = dayKey(timezone, new Date(now.getTime() - DAY_MS));
  const today: DayTotals = { total: 0, count: 0 };
  const yesterday: DayTotals = { total: 0, count: 0 };
  for (const record of records) {
    const key = dayKey(timezone, new Date(record.createdAt));
    const bucket = key === todayKey ? today : key === yesterdayKey ? yesterday : null;
    if (bucket) {
      bucket.total += record.amount;
      bucket.count += 1;
    }
  }
  return { today, yesterday };
}

/** Clientes nuevos hoy y ayer. */
export function newClients(clients: ReadonlyArray<{ createdAt: string }>, timezone: string, now: Date = new Date()): { today: number; yesterday: number } {
  const todayKey = dayKey(timezone, now);
  const yesterdayKey = dayKey(timezone, new Date(now.getTime() - DAY_MS));
  let today = 0;
  let yesterday = 0;
  for (const client of clients) {
    const key = dayKey(timezone, new Date(client.createdAt));
    if (key === todayKey) today += 1;
    else if (key === yesterdayKey) yesterday += 1;
  }
  return { today, yesterday };
}

/** Productos por reponer o agotados, del más crítico (menos unidades) al menos. */
export function lowStockList(items: ReadonlyArray<Pick<Item, 'id' | 'name' | 'stock' | 'stockStatus'>>, limit = 4): Array<Pick<Item, 'id' | 'name' | 'stock' | 'stockStatus'>> {
  return items
    .filter((item) => item.stockStatus === 'reorder' || item.stockStatus === 'out_of_stock')
    .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export type ActivityKind = 'service' | 'client' | 'stock';
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** Milisegundos desde epoch. */
  at: number;
  /** Nombre principal (cliente, producto). */
  primary: string;
  /** Detalle (servicio realizado). */
  secondary?: string;
  amount?: number;
  /** Unidades restantes (stock). */
  units?: number;
}

export interface ActivityInput {
  records?: ReadonlyArray<{ id: string; clientName: string; label: string; amount: number; createdAt: string }>;
  clients?: ReadonlyArray<{ id: string; name: string; createdAt: string }>;
  items?: ReadonlyArray<Pick<Item, 'id' | 'name' | 'stock' | 'stockStatus' | 'updatedAt'>>;
  limit?: number;
}

/**
 * Línea de tiempo con lo que realmente pasó: servicios registrados, clientes nuevos y productos que quedaron con poco
 * stock (por su última actualización). Cada fuente es opcional: solo entra la que esta persona puede ver.
 */
export function buildActivity({ records = [], clients = [], items = [], limit = 8 }: ActivityInput): ActivityItem[] {
  const events: ActivityItem[] = [
    ...records.map((r): ActivityItem => ({ id: `service:${r.id}`, kind: 'service', at: Date.parse(r.createdAt), primary: r.clientName, secondary: r.label, amount: r.amount })),
    ...clients.map((c): ActivityItem => ({ id: `client:${c.id}`, kind: 'client', at: Date.parse(c.createdAt), primary: c.name })),
    ...items.filter((i) => i.stockStatus === 'reorder' || i.stockStatus === 'out_of_stock').map((i): ActivityItem => ({ id: `stock:${i.id}`, kind: 'stock', at: Date.parse(i.updatedAt), primary: i.name, units: i.stock })),
  ].filter((event) => Number.isFinite(event.at));
  return events.sort((a, b) => b.at - a.at).slice(0, limit);
}

export interface DaySummary {
  count: number;
  total: number;
  /** Ticket promedio (total ÷ servicios); `null` si hoy no hubo servicios. */
  average: number | null;
  /** Servicio más repetido hoy; `null` si no hubo o si hay empate (no se elige uno al azar). */
  topLabel: string | null;
}

/** Resumen de los servicios de HOY (día del negocio): cuántos, cuánto, ticket promedio y el más pedido. */
export function daySummary(records: ReadonlyArray<{ amount: number; label: string; createdAt: string }>, timezone: string, now: Date = new Date()): DaySummary {
  const todayKey = dayKey(timezone, now);
  const counts = new Map<string, number>();
  let total = 0;
  let count = 0;
  for (const record of records) {
    if (dayKey(timezone, new Date(record.createdAt)) !== todayKey) continue;
    total += record.amount;
    count += 1;
    counts.set(record.label, (counts.get(record.label) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const topLabel = ranked.length > 0 && (ranked.length === 1 || ranked[0]![1] > ranked[1]![1]) ? ranked[0]![0] : null;
  return { count, total, average: count > 0 ? Math.round(total / count) : null, topLabel };
}

export type PlanCardKind = 'trial' | 'active' | 'grace' | 'blocked';
export interface PlanCard {
  kind: PlanCardKind;
  /** Fecha relevante (fin de prueba o renovación); `null` si no hay. */
  date: string | null;
}

/**
 * Tarjeta del plan en la barra lateral, con el estado REAL de la suscripción. Devuelve `null` (no se muestra) si nunca
 * eligió plan o canceló a propósito: no se le ofrece un "plan activo" que no tiene.
 */
export function planCard(subscription: { status: string; hasAccess: boolean; trialEndsAt: string | null; currentPeriodEnd: string | null } | undefined): PlanCard | null {
  if (!subscription) return null;
  if (subscription.status === 'trial' && subscription.hasAccess) return { kind: 'trial', date: subscription.trialEndsAt };
  if (subscription.status === 'active' && subscription.hasAccess) return { kind: 'active', date: subscription.currentPeriodEnd };
  if (subscription.status === 'past_due') return { kind: subscription.hasAccess ? 'grace' : 'blocked', date: null };
  if (subscription.status === 'expired') return { kind: 'blocked', date: null };
  return null;
}
