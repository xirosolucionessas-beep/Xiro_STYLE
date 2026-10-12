import { BUSINESS_TYPES, translate } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { badgeText, buildAlerts, dismissAlert, emptyAlertState, markAllRead, markRead, markSeen, parseAlertState, pendingAlerts, relativeTime, serializeAlertState, serverNotificationAlert, visibleAlerts } from '../src/lib/alerts';
import { greetingKey, msUntilNextGreeting } from '../src/lib/greeting';
import { dayKey, formatCompactMoney, lowStock, salesToday, TEAM_LABEL_KEYS } from '../src/lib/homeMetrics';

const at = (h: number, m = 0) => new Date(2026, 8, 24, h, m, 0, 0);

describe('saludo según la hora', () => {
  it.each([
    [0, 'greeting_evening'],
    [4, 'greeting_evening'], // 04:59
    [5, 'greeting_morning'], // 05:00
    [11, 'greeting_morning'], // 11:59
    [12, 'greeting_afternoon'], // 12:00
    [18, 'greeting_afternoon'], // 18:59
    [19, 'greeting_evening'], // 19:00
    [23, 'greeting_evening'],
  ])('hora %i → %s', (hour, key) => {
    expect(greetingKey(hour)).toBe(key);
  });

  it('los límites exactos usan minutos: 04:59 noche, 05:00 mañana, 11:59 mañana, 12:00 tarde, 18:59 tarde, 19:00 noche', () => {
    expect(greetingKey(at(4, 59).getHours())).toBe('greeting_evening');
    expect(greetingKey(at(5, 0).getHours())).toBe('greeting_morning');
    expect(greetingKey(at(11, 59).getHours())).toBe('greeting_morning');
    expect(greetingKey(at(12, 0).getHours())).toBe('greeting_afternoon');
    expect(greetingKey(at(18, 59).getHours())).toBe('greeting_afternoon');
    expect(greetingKey(at(19, 0).getHours())).toBe('greeting_evening');
  });

  it('calcula cuánto falta para el próximo cambio (para reprogramarlo sin reiniciar la app)', () => {
    expect(msUntilNextGreeting(at(4, 59))).toBe(60_000);
    expect(msUntilNextGreeting(at(11, 59))).toBe(60_000);
    expect(msUntilNextGreeting(at(18, 30))).toBe(30 * 60_000);
    expect(msUntilNextGreeting(at(19, 0))).toBe(10 * 60 * 60_000); // 19:00 → 05:00 del día siguiente
    expect(msUntilNextGreeting(at(23, 0))).toBe(6 * 60 * 60_000);
    expect(msUntilNextGreeting(at(2, 0))).toBe(3 * 60 * 60_000);
  });

  it('los textos existen en ES y EN', () => {
    for (const key of ['greeting_morning', 'greeting_afternoon', 'greeting_evening', 'home_tagline']) {
      expect(translate('es', key)).not.toBe(key);
      expect(translate('en', key)).not.toBe(key);
    }
    expect(translate('es', 'greeting_afternoon')).toBe('Buenas tardes');
    expect(translate('en', 'greeting_evening')).toBe('Good evening');
  });
});

describe('ventas de hoy', () => {
  const tz = 'America/Bogota';
  it('suma solo lo cobrado hoy en el día del negocio; cero real es 0', () => {
    const now = new Date('2026-09-24T15:00:00Z'); // 10:00 en Bogotá
    const records = [
      { amount: 30_000, createdAt: '2026-09-24T13:00:00Z' },
      { amount: 50_000, createdAt: '2026-09-24T14:59:00Z' },
      { amount: 99_000, createdAt: '2026-09-23T20:00:00Z' }, // ayer
    ];
    expect(salesToday(records, tz, now)).toBe(80_000);
    expect(salesToday([], tz, now)).toBe(0);
  });

  it('respeta el corte de medianoche del negocio, no el de UTC', () => {
    const now = new Date('2026-09-25T02:00:00Z'); // 21:00 del 24 en Bogotá (UTC ya es 25)
    expect(dayKey(tz, now)).toBe('2026-09-24');
    expect(salesToday([{ amount: 10_000, createdAt: '2026-09-24T23:30:00Z' }], tz, now)).toBe(10_000); // 18:30 del 24 en Bogotá
    const justAfterMidnight = new Date('2026-09-25T05:01:00Z'); // 00:01 del 25 en Bogotá
    expect(salesToday([{ amount: 10_000, createdAt: '2026-09-25T04:59:00Z' }], tz, justAfterMidnight)).toBe(0); // 23:59 del 24: ya es de ayer
  });

  it('una zona horaria inválida no rompe el cálculo', () => {
    expect(() => salesToday([{ amount: 1, createdAt: new Date().toISOString() }], 'No/Existe')).not.toThrow();
  });
});

describe('formatCompactMoney', () => {
  it.each([
    [680_000, 'COP', '$680.000'],
    [0, 'COP', '$0'],
    [999_999, 'COP', '$999.999'],
    [12_400_000, 'COP', '$12,4 M'],
    [3_000_000, 'COP', '$3 M'],
  ] as const)('%i %s → %s', (amount, currency, expected) => {
    expect(formatCompactMoney(amount, currency)).toBe(expected);
  });
});

describe('etiqueta del equipo por tipo de negocio', () => {
  it('cada tipo tiene su etiqueta en ES y EN', () => {
    const es = BUSINESS_TYPES.map((type) => translate('es', TEAM_LABEL_KEYS[type]));
    expect(es).toEqual(['Barberos', 'Estilistas', 'Terapeutas', 'Manicuristas', 'Equipo']);
    for (const type of BUSINESS_TYPES) expect(translate('en', TEAM_LABEL_KEYS[type])).not.toBe(TEAM_LABEL_KEYS[type]);
  });
});

describe('alertas', () => {
  const okSub = { status: 'active' as const, hasAccess: true, trialEndsAt: null, currentPeriodEnd: '2099-01-01T00:00:00Z', gracePeriodEndsAt: null, cancelAtPeriodEnd: false };
  const items = [{ stockStatus: 'available' as const }, { stockStatus: 'reorder' as const }, { stockStatus: 'out_of_stock' as const }];

  it('bajo inventario cuenta por reponer y agotados, y enlaza al inventario filtrado', () => {
    expect(lowStock(items)).toEqual({ count: 2, reorder: 1, outOfStock: 1 });
    const [alert] = buildAlerts({ isOwner: false, canCatalog: true, stock: lowStock(items) });
    expect(alert).toMatchObject({ id: 'low_stock', priority: 'warning', detailParams: { n: 2 }, href: '/inventory?status=out_of_stock' });
  });

  it('sin nada que avisar no hay alertas ("Todo en orden")', () => {
    expect(buildAlerts({ isOwner: true, canCatalog: true, stock: lowStock([{ stockStatus: 'available' }]), cashOpened: true, subscription: okSub })).toEqual([]);
  });

  it('la caja sin abrir solo se avisa al dueño y solo si se SABE que no está abierta', () => {
    expect(buildAlerts({ isOwner: true, canCatalog: false, cashOpened: false }).map((a) => a.id)).toEqual(['cash_closed']);
    expect(buildAlerts({ isOwner: true, canCatalog: false, cashOpened: undefined })).toEqual([]); // cargando
    expect(buildAlerts({ isOwner: false, canCatalog: false, cashOpened: false })).toEqual([]); // empleado
  });

  it('suscripción: bloqueada es urgente, en gracia advierte, por vencer informa; un empleado no la ve', () => {
    const blocked = { ...okSub, status: 'expired' as const, hasAccess: false };
    const grace = { ...okSub, status: 'past_due' as const, hasAccess: true };
    const soon = { ...okSub, currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString() };
    expect(buildAlerts({ isOwner: true, canCatalog: false, subscription: blocked })[0]).toMatchObject({ priority: 'urgent', titleKey: 'alert_sub_blocked' });
    expect(buildAlerts({ isOwner: true, canCatalog: false, subscription: grace })[0]).toMatchObject({ priority: 'warning' });
    expect(buildAlerts({ isOwner: true, canCatalog: false, subscription: soon })[0]).toMatchObject({ priority: 'info' });
    expect(buildAlerts({ isOwner: false, canCatalog: false, subscription: blocked })).toEqual([]);
  });

  it('se ordenan por prioridad: urgente, advertencia, informativa', () => {
    const alerts = buildAlerts({ isOwner: true, canCatalog: true, stock: lowStock(items), cashOpened: false, subscription: { ...okSub, status: 'expired', hasAccess: false } });
    expect(alerts.map((a) => a.priority)).toEqual(['urgent', 'warning', 'info']);
  });

  it('todos los textos de alertas existen en ES y EN', () => {
    const keys = new Set(['alert_low_stock', 'alert_low_stock_detail', 'alert_cash_closed', 'alert_cash_closed_detail', 'alert_sub_blocked', 'alert_sub_blocked_detail', 'alert_sub_grace', 'alert_sub_grace_detail', 'alert_sub_expiring', 'alert_sub_expiring_detail', 'notif_empty', 'notif_mark_all', 'home_all_good']);
    for (const key of keys) {
      expect(translate('es', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
  });
});

describe('estado de lectura de alertas (la campana y la tarjeta usan el MISMO conteo)', () => {
  const alerts = buildAlerts({ isOwner: true, canCatalog: true, stock: lowStock([{ stockStatus: 'reorder' }]), cashOpened: false });

  it('pendientes = sin leer ni descartar; leer las quita del conteo pero no de la lista', () => {
    let state = emptyAlertState();
    expect(pendingAlerts(alerts, state)).toHaveLength(2);
    state = markRead(state, alerts[0]!.signature);
    expect(pendingAlerts(alerts, state)).toHaveLength(1);
    expect(visibleAlerts(alerts, state)).toHaveLength(2);
    state = markAllRead(state, alerts);
    expect(pendingAlerts(alerts, state)).toHaveLength(0);
  });

  it('descartar la quita de todo; si la situación cambia (otra firma) vuelve a aparecer sin leer', () => {
    let state = dismissAlert(emptyAlertState(), 'low_stock:1:0');
    expect(visibleAlerts(alerts, state).map((a) => a.id)).toEqual(['cash_closed']);
    const worse = buildAlerts({ isOwner: true, canCatalog: true, stock: lowStock([{ stockStatus: 'reorder' }, { stockStatus: 'reorder' }]) });
    expect(pendingAlerts(worse, state).map((a) => a.signature)).toEqual(['low_stock:2:0']);
    state = markAllRead(state, worse);
    expect(pendingAlerts(worse, state)).toEqual([]);
  });

  it('guarda cuándo se vio por primera vez y no lo pisa', () => {
    const first = markSeen(emptyAlertState(), alerts, 1_000);
    const again = markSeen(first, alerts, 9_000);
    expect(again).toBe(first);
    expect(first.seen[alerts[0]!.signature]).toBe(1_000);
  });

  it('serializa y recupera; ante datos corruptos vuelve a vacío sin lanzar', () => {
    const state = markAllRead(markSeen(emptyAlertState(), alerts, 5), alerts);
    expect(parseAlertState(serializeAlertState(state))).toEqual(state);
    for (const raw of [null, '', 'no json', '{"read":42,"seen":"x"}']) expect(() => parseAlertState(raw)).not.toThrow();
    expect(parseAlertState('{"read":[1,"a"],"dismissed":"x","seen":{"k":"no","j":3}}')).toEqual({ read: ['a'], dismissed: [], seen: { j: 3 } });
  });
});

describe('avisos reales del backend (centro de notificaciones) convertidos a la misma forma que las alertas locales', () => {
  it('cada categoría tiene su prioridad; facturación es urgente, el resto informativo', () => {
    const base = { id: 'n1', titleKey: 'push_appt_new_title', bodyKey: 'push_appt_new_body', params: { client: 'Ana' }, href: '/agenda', read: false, createdAt: '2026-01-01T00:00:00Z' } as const;
    expect(serverNotificationAlert({ ...base, category: 'billing' })).toMatchObject({ priority: 'urgent', id: 'server:n1', signature: 'server:n1', serverId: 'n1', href: '/agenda' });
    expect(serverNotificationAlert({ ...base, category: 'appointments' })).toMatchObject({ priority: 'info' });
    expect(serverNotificationAlert({ ...base, category: 'loyalty' })).toMatchObject({ priority: 'info' });
    expect(serverNotificationAlert({ ...base, category: 'reviews' })).toMatchObject({ priority: 'info' });
  });

  it('sin href (nunca debería pasar, pero por si acaso) cae en la pantalla de Notificaciones, no en una ruta vacía', () => {
    const alert = serverNotificationAlert({ id: 'n2', category: 'loyalty', titleKey: 'push_loyalty_reward_title', bodyKey: 'push_loyalty_reward_body', params: {}, href: null, read: false, createdAt: '2026-01-01T00:00:00Z' });
    expect(alert.href).toBe('/notifications');
  });

  it('todos los titleKey/bodyKey que push.ts puede guardar existen en ES y EN (si no, se verían como la clave literal en la campana)', () => {
    const keys = ['push_appt_new_title', 'push_appt_new_body', 'push_appt_cancelled_title', 'push_appt_cancelled_body', 'push_appt_rescheduled_title', 'push_appt_rescheduled_body', 'push_appt_reminder_title', 'push_appt_reminder_body', 'push_loyalty_reward_title', 'push_loyalty_reward_body', 'push_billing_issue_title', 'push_billing_issue_body', 'push_billing_expired_title', 'push_billing_expired_body'];
    for (const key of keys) {
      expect(translate('es', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
  });
});

describe('insignia de la campana y hora relativa', () => {
  it.each([
    [0, ''],
    [1, '1'],
    [9, '9'],
    [10, '9+'],
    [57, '9+'],
  ])('%i → "%s"', (count, text) => {
    expect(badgeText(count)).toBe(text);
  });

  it('hora relativa en español e inglés', () => {
    const now = 10 * 3_600_000;
    expect(relativeTime(now - 10 * 60_000, now, 'es')).toBe('hace 10 minutos');
    expect(relativeTime(now - 10 * 60_000, now, 'en')).toBe('10 minutes ago');
    expect(relativeTime(now - 2 * 3_600_000, now, 'es')).toBe('hace 2 horas');
    expect(relativeTime(now - 3 * 86_400_000, now, 'en')).toBe('3 days ago');
    expect(relativeTime(now + 5_000, now, 'es')).toBe('ahora'); // reloj adelantado: nunca "en el futuro"
  });
});
