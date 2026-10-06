import { subscriptionNotice, type Item, type NotificationCategory, type NotificationDto, type Subscription } from '@xiro/shared';
import { lowStock } from './homeMetrics';

/**
 * Alertas del negocio calculadas SOLO con datos que la app ya consulta (inventario, caja del día, suscripción): no
 * hay historial de notificaciones en el backend. Es la ÚNICA fuente de la tarjeta "Alertas" del Inicio, de la campana
 * y de la pantalla de Notificaciones, así que sus contadores siempre coinciden.
 */
export type AlertPriority = 'urgent' | 'warning' | 'info';

export interface HomeAlert {
  /** Tipo de alerta (estable). */
  id: string;
  /** Identifica ESTA situación concreta (p. ej. "low_stock:3"): si cambia, vuelve a ser una alerta nueva sin leer. */
  signature: string;
  priority: AlertPriority;
  titleKey: string;
  detailKey?: string;
  detailParams?: Record<string, number | string>;
  /** Pantalla existente a la que lleva. */
  href: string;
  /** Solo en avisos reales del centro de notificaciones (backend): su id de fila, para marcarlo leído también ahí
   * (y no solo en este dispositivo). Ausente en las 3 alertas calculadas localmente (suscripción, stock, caja). */
  serverId?: string;
}

export interface AlertInputs {
  isOwner: boolean;
  /** Puede ver catálogo e inventario. */
  canCatalog: boolean;
  /** `undefined` mientras carga o si la persona no puede verlos. */
  items?: ReadonlyArray<Pick<Item, 'stockStatus'>>;
  /** `undefined` = no se sabe (cargando / sin permiso): no se alerta. */
  cashOpened?: boolean;
  subscription?: Pick<Subscription, 'status' | 'hasAccess' | 'trialEndsAt' | 'currentPeriodEnd' | 'gracePeriodEndsAt' | 'cancelAtPeriodEnd'>;
  now?: Date;
}

const ORDER: Record<AlertPriority, number> = { urgent: 0, warning: 1, info: 2 };

export function buildAlerts(input: AlertInputs): HomeAlert[] {
  const alerts: HomeAlert[] = [];

  if (input.isOwner && input.subscription) {
    const notice = subscriptionNotice(input.subscription, input.now);
    if (notice === 'blocked') alerts.push({ id: 'subscription', signature: 'subscription:blocked', priority: 'urgent', titleKey: 'alert_sub_blocked', detailKey: 'alert_sub_blocked_detail', href: '/subscription' });
    else if (notice === 'grace') alerts.push({ id: 'subscription', signature: 'subscription:grace', priority: 'warning', titleKey: 'alert_sub_grace', detailKey: 'alert_sub_grace_detail', href: '/subscription' });
    else if (notice === 'expiring_soon') alerts.push({ id: 'subscription', signature: 'subscription:expiring', priority: 'info', titleKey: 'alert_sub_expiring', detailKey: 'alert_sub_expiring_detail', href: '/subscription' });
  }

  if (input.canCatalog && input.items) {
    const stock = lowStock(input.items);
    if (stock.count > 0) {
      alerts.push({
        id: 'low_stock',
        signature: `low_stock:${stock.reorder}:${stock.outOfStock}`,
        priority: 'warning',
        titleKey: 'alert_low_stock',
        detailKey: 'alert_low_stock_detail',
        detailParams: { n: stock.count },
        href: `/inventory?status=${stock.outOfStock > 0 ? 'out_of_stock' : 'reorder'}`,
      });
    }
  }

  if (input.isOwner && input.cashOpened === false) {
    alerts.push({ id: 'cash_closed', signature: 'cash_closed', priority: 'info', titleKey: 'alert_cash_closed', detailKey: 'alert_cash_closed_detail', href: '/cash-opening' });
  }

  return alerts.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
}

const CATEGORY_PRIORITY: Record<NotificationCategory, AlertPriority> = {
  billing: 'urgent',
  security: 'urgent',
  appointments: 'info',
  loyalty: 'info',
  reviews: 'info',
  clients: 'info',
  sales: 'info',
  employees: 'info',
  inventory: 'warning',
};

/**
 * Convierte un aviso YA GUARDADO en el backend (cita nueva/cancelada/reprogramada, reseña, premio de fidelización,
 * problema de facturación — ver push.ts) a la misma forma que las 3 alertas calculadas localmente, para que la
 * campana, la tarjeta "Alertas" y la pantalla de Notificaciones los muestren juntos sin duplicar código de UI.
 */
export function serverNotificationAlert(n: NotificationDto): HomeAlert {
  return {
    id: `server:${n.id}`,
    signature: `server:${n.id}`,
    priority: CATEGORY_PRIORITY[n.category] ?? 'info',
    titleKey: n.titleKey,
    detailKey: n.bodyKey,
    detailParams: n.params,
    href: n.href ?? '/notifications',
    serverId: n.id,
  };
}

/* ---------- Estado local: leídas, descartadas y desde cuándo se ven ---------- */

export interface AlertState {
  read: string[];
  dismissed: string[];
  /** signature → primera vez que se vio (ms), para mostrar "hace 10 min". */
  seen: Record<string, number>;
}

export const emptyAlertState = (): AlertState => ({ read: [], dismissed: [], seen: {} });

const MAX_ENTRIES = 100;

export function parseAlertState(raw: string | null): AlertState {
  if (!raw) return emptyAlertState();
  try {
    const parsed = JSON.parse(raw) as Partial<AlertState>;
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(-MAX_ENTRIES) : []);
    const seen: Record<string, number> = {};
    if (parsed.seen && typeof parsed.seen === 'object') for (const [key, value] of Object.entries(parsed.seen)) if (typeof value === 'number' && Number.isFinite(value)) seen[key] = value;
    return { read: strings(parsed.read), dismissed: strings(parsed.dismissed), seen };
  } catch {
    return emptyAlertState();
  }
}

export function serializeAlertState(state: AlertState): string {
  const seenEntries = Object.entries(state.seen).sort((a, b) => a[1] - b[1]).slice(-MAX_ENTRIES);
  return JSON.stringify({ read: state.read.slice(-MAX_ENTRIES), dismissed: state.dismissed.slice(-MAX_ENTRIES), seen: Object.fromEntries(seenEntries) });
}

/** Anota la primera vez que se ve cada alerta (no cambia si ya estaba). Devuelve el mismo objeto si no hay nada nuevo. */
export function markSeen(state: AlertState, alerts: readonly HomeAlert[], now: number): AlertState {
  const missing = alerts.filter((alert) => state.seen[alert.signature] === undefined);
  if (missing.length === 0) return state;
  return { ...state, seen: { ...state.seen, ...Object.fromEntries(missing.map((alert) => [alert.signature, now])) } };
}

const isDismissed = (state: AlertState, alert: HomeAlert) => state.dismissed.includes(alert.signature);

/** Las que se muestran en la pantalla de Notificaciones: todas menos las descartadas. */
export const visibleAlerts = (alerts: readonly HomeAlert[], state: AlertState): HomeAlert[] => alerts.filter((alert) => !isDismissed(state, alert));

/** Pendientes = visibles y sin leer. Su cantidad es la de la campana Y la de la tarjeta "Alertas" del Inicio. */
export const pendingAlerts = (alerts: readonly HomeAlert[], state: AlertState): HomeAlert[] => visibleAlerts(alerts, state).filter((alert) => !state.read.includes(alert.signature));

export const markRead = (state: AlertState, signature: string): AlertState => (state.read.includes(signature) ? state : { ...state, read: [...state.read, signature] });
export const markAllRead = (state: AlertState, alerts: readonly HomeAlert[]): AlertState => alerts.reduce((current, alert) => markRead(current, alert.signature), state);
export const dismissAlert = (state: AlertState, signature: string): AlertState => (state.dismissed.includes(signature) ? state : { ...state, dismissed: [...state.dismissed, signature] });

/** Texto de la insignia de la campana: "9+" si pasa de 9; vacío (se oculta) en 0. */
export const badgeText = (count: number): string => (count <= 0 ? '' : count > 9 ? '9+' : String(count));

/** "hace 10 min" / "10 min ago" (sin depender de zonas horarias). */
export function relativeTime(fromMs: number, nowMs: number, language: 'es' | 'en'): string {
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  const format = new Intl.RelativeTimeFormat(language === 'en' ? 'en' : 'es', { numeric: 'auto' });
  if (seconds < 60) return format.format(0, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return format.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format.format(-hours, 'hour');
  return format.format(-Math.floor(hours / 24), 'day');
}
