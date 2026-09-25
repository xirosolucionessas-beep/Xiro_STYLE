import { describe, expect, it } from 'vitest';
import { activeClients, catalogStats, clientHistory, clientRows, inventoryValue, isTruncated, margin, newClientsInPeriod, newThisMonth, periodTotals, RECORD_LIMIT, salesByDay, topClients, topServices } from '../src/lib/sections';

const TZ = 'America/Bogota';
const now = new Date('2026-09-24T20:00:00Z'); // 24 sep, 15:00 en Bogotá
const at = (day: string, hour = 15) => `2026-09-${day}T${String(hour + 5).padStart(2, '0')}:00:00Z`;

describe('clientes', () => {
  const clients = [
    { id: 'a', name: 'Ana', phone: '300', email: null, createdAt: at('03') },
    { id: 'b', name: 'Beto', phone: null, email: 'b@x.co', createdAt: '2026-08-30T15:00:00Z' },
  ];

  it('une clientes con visitas y último servicio; sin registros disponibles deja las visitas en null', () => {
    const rows = clientRows(clients, [
      { clientId: 'a', createdAt: at('10') },
      { clientId: 'a', createdAt: at('20') },
    ]);
    expect(rows[0]).toMatchObject({ visits: 2, lastVisit: Date.parse(at('20')) });
    expect(rows[1]).toMatchObject({ visits: 0, lastVisit: null });
    expect(clientRows(clients, undefined)[0]).toMatchObject({ visits: null, lastVisit: null });
  });

  it('cuenta nuevos del mes según el mes del negocio y activos de los últimos días', () => {
    expect(newThisMonth(clients, TZ, now)).toBe(1);
    expect(activeClients([{ clientId: 'a', createdAt: at('20') }, { clientId: 'a', createdAt: at('22') }, { clientId: 'b', createdAt: at('01') }], 7, now)).toBe(1);
  });
});

describe('servicios e inventario', () => {
  it('estadísticas del catálogo', () => {
    expect(catalogStats([{ published: true, price: 10_000 }, { published: false, price: 20_000 }])).toEqual({ total: 2, published: 1, hidden: 1, averagePrice: 15_000 });
    expect(catalogStats([])).toEqual({ total: 0, published: 0, hidden: 0, averagePrice: null });
  });

  it('el valor de inventario ignora lo que no tiene costo y es null si nada lo tiene', () => {
    expect(inventoryValue([{ stock: 3, internalUnitCost: 1000 }, { stock: 10, internalUnitCost: 0 }])).toBe(3000);
    expect(inventoryValue([{ stock: 3, internalUnitCost: 0 }])).toBeNull();
  });
});

describe('reportes', () => {
  const records = [
    { amount: 30_000, label: 'Corte', clientName: 'Ana', createdAt: at('24') },
    { amount: 20_000, label: 'Corte', clientName: 'Beto', createdAt: at('23') },
    { amount: 50_000, label: 'Tinte', clientName: 'Ana', createdAt: at('20') },
    { amount: 10_000, label: 'Barba', clientName: 'Beto', createdAt: at('14') }, // periodo anterior (7 días)
    { amount: 99_000, label: 'Viejo', clientName: 'Zoe', createdAt: at('01') }, // fuera de ambos
  ];

  it('genera un cubo por día (incluye días sin actividad) terminando hoy', () => {
    const days = salesByDay(records, TZ, 7, now);
    expect(days).toHaveLength(7);
    expect(days[6]).toEqual({ key: '2026-09-24', total: 30_000, count: 1 });
    expect(days[5]).toMatchObject({ key: '2026-09-23', total: 20_000 });
    expect(days[4]).toMatchObject({ total: 0, count: 0 });
  });

  it('compara el periodo con el anterior de igual duración', () => {
    const { current, previous } = periodTotals(records, TZ, 7, now);
    expect(current).toEqual({ total: 100_000, count: 3, average: 33_333 });
    expect(previous).toEqual({ total: 10_000, count: 1, average: 10_000 });
    expect(periodTotals([], TZ, 7, now).current.average).toBeNull();
  });

  it('rankea servicios por cantidad y clientes por monto, solo del periodo', () => {
    expect(topServices(records, TZ, 7, now).map((r) => [r.label, r.count])).toEqual([['Corte', 2], ['Tinte', 1]]);
    expect(topClients(records, TZ, 7, now).map((r) => [r.label, r.total])).toEqual([['Ana', 80_000], ['Beto', 20_000]]);
    expect(topServices(records, TZ, 7, now, 1)).toHaveLength(1);
  });

  it('clientes nuevos dentro del periodo', () => {
    expect(newClientsInPeriod([{ createdAt: at('22') }, { createdAt: at('02') }], TZ, 7, now)).toBe(1);
  });

  it('avisa cuando el historial puede estar cortado por el límite del servidor', () => {
    expect(isTruncated(Array.from({ length: RECORD_LIMIT }))).toBe(true);
    expect(isTruncated([])).toBe(false);
  });
});

describe('fichas', () => {
  it('margen sobre el precio, y null sin costo o sin precio', () => {
    expect(margin(25_000, 10_000)).toEqual({ amount: 15_000, percent: 60 });
    expect(margin(25_000, 0)).toBeNull();
    expect(margin(0, 5_000)).toBeNull();
  });

  it('resumen del historial de un cliente', () => {
    expect(clientHistory([{ amount: 30_000, createdAt: at('20') }, { amount: 20_000, createdAt: at('22') }])).toEqual({ count: 2, total: 50_000, last: Date.parse(at('22')) });
    expect(clientHistory([])).toEqual({ count: 0, total: 0, last: null });
  });
});
