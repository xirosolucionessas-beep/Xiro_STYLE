import { describe, expect, it } from 'vitest';
import { buildActivity, daySummary, lowStockList, newClients, planCard, serviceDays, variation } from '../src/lib/dashboard';
import { greetingKeyIn, hourInTimezone } from '../src/lib/greeting';
import { fold, isSearchable, searchItems } from '../src/lib/search';

const TZ = 'America/Bogota'; // UTC-5, sin horario de verano

describe('saludo según la zona horaria del negocio', () => {
  it('usa la hora del negocio, no la del navegador', () => {
    const utcNoon = new Date('2026-09-24T12:00:00Z'); // 07:00 en Bogotá, 14:00 en Madrid
    expect(hourInTimezone(TZ, utcNoon)).toBe(7);
    expect(hourInTimezone('Europe/Madrid', utcNoon)).toBe(14);
    expect(greetingKeyIn(TZ, utcNoon)).toBe('greeting_morning');
    expect(greetingKeyIn('Europe/Madrid', utcNoon)).toBe('greeting_afternoon');
  });

  it('respeta los límites 04:59/05:00, 11:59/12:00 y 18:59/19:00 en la zona del negocio', () => {
    const at = (h: number, m: number) => new Date(Date.UTC(2026, 8, 24, h + 5, m)); // hora de Bogotá → UTC
    expect(greetingKeyIn(TZ, at(4, 59))).toBe('greeting_evening');
    expect(greetingKeyIn(TZ, at(5, 0))).toBe('greeting_morning');
    expect(greetingKeyIn(TZ, at(11, 59))).toBe('greeting_morning');
    expect(greetingKeyIn(TZ, at(12, 0))).toBe('greeting_afternoon');
    expect(greetingKeyIn(TZ, at(18, 59))).toBe('greeting_afternoon');
    expect(greetingKeyIn(TZ, at(19, 0))).toBe('greeting_evening');
  });

  it('medianoche cuenta como 0 (no 24) y una zona inválida no rompe', () => {
    expect(hourInTimezone(TZ, new Date('2026-09-24T05:00:00Z'))).toBe(0);
    expect(() => hourInTimezone('No/Existe', new Date())).not.toThrow();
  });
});

describe('variación frente a ayer', () => {
  it.each([
    [150, 100, 'up', 50],
    [50, 100, 'down', -50],
    [100, 100, 'flat', 0],
    [0, 0, 'flat', 0],
  ] as const)('%i vs %i → %s (%i%%)', (current, previous, direction, percent) => {
    expect(variation(current, previous)).toMatchObject({ direction, percent });
  });

  it('sin base de comparación sube sin inventar un porcentaje infinito', () => {
    expect(variation(30_000, 0)).toEqual({ direction: 'up', percent: null, delta: 30_000 });
  });
});

describe('ventas y clientes de hoy y ayer (día del negocio)', () => {
  const now = new Date('2026-09-24T20:00:00Z'); // 15:00 del 24 en Bogotá
  const records = [
    { amount: 30_000, createdAt: '2026-09-24T14:00:00Z' },
    { amount: 20_000, createdAt: '2026-09-24T18:00:00Z' },
    { amount: 40_000, createdAt: '2026-09-23T22:00:00Z' }, // 17:00 del 23: ayer
    { amount: 99_000, createdAt: '2026-09-20T22:00:00Z' }, // otro día: no cuenta
  ];

  it('separa hoy de ayer y cuenta los servicios', () => {
    expect(serviceDays(records, TZ, now)).toEqual({ today: { total: 50_000, count: 2 }, yesterday: { total: 40_000, count: 1 } });
  });

  it('respeta el corte de medianoche del negocio', () => {
    const lateNight = [{ amount: 10_000, createdAt: '2026-09-25T04:30:00Z' }]; // 23:30 del 24 en Bogotá
    expect(serviceDays(lateNight, TZ, now).today.count).toBe(1);
  });

  it('cuenta los clientes nuevos de hoy y de ayer', () => {
    expect(newClients([{ createdAt: '2026-09-24T15:00:00Z' }, { createdAt: '2026-09-24T16:00:00Z' }, { createdAt: '2026-09-23T15:00:00Z' }, { createdAt: '2026-08-01T15:00:00Z' }], TZ, now)).toEqual({ today: 2, yesterday: 1 });
  });
});

describe('resumen del día', () => {
  const now = new Date('2026-09-24T20:00:00Z');
  const at = (label: string, amount: number, createdAt = '2026-09-24T15:00:00Z') => ({ label, amount, createdAt });

  it('calcula total, ticket promedio y el servicio más pedido de hoy', () => {
    expect(daySummary([at('Corte', 25_000), at('Corte', 25_000), at('Barba', 10_000), at('Corte', 99, '2026-09-23T15:00:00Z')], TZ, now)).toEqual({ count: 3, total: 60_000, average: 20_000, topLabel: 'Corte' });
  });

  it('sin servicios no inventa promedio ni favorito, y un empate no elige al azar', () => {
    expect(daySummary([], TZ, now)).toEqual({ count: 0, total: 0, average: null, topLabel: null });
    expect(daySummary([at('Corte', 1000), at('Barba', 1000)], TZ, now).topLabel).toBeNull();
  });
});

describe('inventario bajo y actividad reciente', () => {
  const item = (id: string, name: string, stock: number, stockStatus: 'available' | 'reorder' | 'out_of_stock', updatedAt = '2026-09-24T10:00:00Z') => ({ id, name, stock, stockStatus, updatedAt });

  it('lista solo lo bajo, del más crítico al menos, con tope', () => {
    const list = lowStockList([item('1', 'Cera', 3, 'reorder'), item('2', 'Aceite', 0, 'out_of_stock'), item('3', 'Shampoo', 50, 'available'), item('4', 'Gel', 5, 'reorder')], 2);
    expect(list.map((i) => i.name)).toEqual(['Aceite', 'Cera']);
  });

  it('ordena por hora (lo más nuevo primero), mezcla las fuentes y respeta el límite', () => {
    const activity = buildActivity({
      records: [{ id: 'r1', clientName: 'Juan', label: 'Corte', amount: 25_000, createdAt: '2026-09-24T12:00:00Z' }],
      clients: [{ id: 'c1', name: 'Marta', createdAt: '2026-09-24T13:00:00Z' }],
      items: [item('i1', 'Cera', 2, 'reorder', '2026-09-24T11:00:00Z'), item('i2', 'Gel', 40, 'available', '2026-09-24T14:00:00Z')],
    });
    expect(activity.map((a) => `${a.kind}:${a.primary}`)).toEqual(['client:Marta', 'service:Juan', 'stock:Cera']); // "Gel" no está bajo: no es actividad
    expect(buildActivity({ records: [{ id: 'r1', clientName: 'A', label: 'x', amount: 1, createdAt: '2026-09-24T12:00:00Z' }, { id: 'r2', clientName: 'B', label: 'x', amount: 1, createdAt: '2026-09-24T13:00:00Z' }], limit: 1 })).toHaveLength(1);
  });

  it('cada fuente es opcional y las fechas inválidas se descartan', () => {
    expect(buildActivity({})).toEqual([]);
    expect(buildActivity({ clients: [{ id: 'x', name: 'Sin fecha', createdAt: 'no-es-fecha' }] })).toEqual([]);
  });
});

describe('búsqueda global', () => {
  const items = [
    { id: '1', name: 'Corte clásico', categoryName: 'Servicios', price: 25_000 },
    { id: '2', name: 'Manicüre', categoryName: 'Uñas', price: 30_000 },
    { id: '3', name: 'Cera para el cabello', categoryName: 'Productos', price: 18_000 },
    { id: '4', name: 'Corte y barba', categoryName: 'Servicios', price: 40_000 },
  ];

  it('ignora acentos y mayúsculas', () => {
    expect(fold('  JOSÉ ')).toBe('jose');
    expect(searchItems(items, 'manicure').map((i) => i.id)).toEqual(['2']);
  });

  it('primero lo que empieza por la consulta, luego lo que la contiene, luego la categoría', () => {
    expect(searchItems(items, 'cor').map((i) => i.id)).toEqual(['1', '4']);
    expect(searchItems(items, 'cabello').map((i) => i.id)).toEqual(['3']);
    expect(searchItems(items, 'uñas').map((i) => i.id)).toEqual(['2']);
  });

  it('una consulta vacía no devuelve nada, y una letra sola no consulta al servidor', () => {
    expect(searchItems(items, '  ')).toEqual([]);
    expect(isSearchable('c')).toBe(false);
    expect(isSearchable('co')).toBe(true);
  });

  it('respeta el límite', () => {
    expect(searchItems(items, 'c', 2)).toHaveLength(2);
  });
});

describe('tarjeta del plan', () => {
  const sub = (status: string, hasAccess: boolean) => ({ status, hasAccess, trialEndsAt: '2026-10-01T00:00:00Z', currentPeriodEnd: '2026-11-01T00:00:00Z' });

  it('refleja el estado real de la suscripción', () => {
    expect(planCard(sub('trial', true))).toEqual({ kind: 'trial', date: '2026-10-01T00:00:00Z' });
    expect(planCard(sub('active', true))).toEqual({ kind: 'active', date: '2026-11-01T00:00:00Z' });
    expect(planCard(sub('past_due', true))?.kind).toBe('grace');
    expect(planCard(sub('past_due', false))?.kind).toBe('blocked');
    expect(planCard(sub('expired', false))?.kind).toBe('blocked');
  });

  it('no muestra nada si nunca eligió plan, canceló o aún no carga', () => {
    expect(planCard(sub('none', false))).toBeNull();
    expect(planCard(sub('canceled', false))).toBeNull();
    expect(planCard(undefined)).toBeNull();
  });
});
