import { describe, expect, it } from 'vitest';
import {
  activeClients,
  cashBalance,
  catalogStats,
  clientHistory,
  clientRows,
  employeePerformance,
  inventoryValue,
  isTruncated,
  margin,
  newClientsInPeriod,
  newThisMonth,
  openingBaseTotal,
  paymentMethodBreakdown,
  periodTotals,
  RECORD_LIMIT,
  reportBuckets,
  resolveReportRange,
  salesByDay,
  salesSummary,
  topClients,
  topSaleClients,
  topSaleItems,
  topServices,
} from '../src/lib/sections';

const TZ = 'America/Bogota';
const now = new Date('2026-09-24T20:00:00Z'); // 24 sep, 15:00 en Bogotá
const at = (day: string, hour = 15) => `2026-09-${day}T${String(hour + 5).padStart(2, '0')}:00:00Z`;

describe('clientes', () => {
  const clients = [
    { id: 'a', name: 'Ana', phone: '300', email: null, photoUrl: null, createdAt: at('03') },
    { id: 'b', name: 'Beto', phone: null, email: 'b@x.co', photoUrl: null, createdAt: '2026-08-30T15:00:00Z' },
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

describe('reportes: rango de fechas dinámico', () => {
  // `now` = jueves 24 de septiembre de 2026, 15:00 Bogotá.
  it('hoy: 1 día, el anterior es ayer', () => {
    const range = resolveReportRange('today', TZ, now);
    expect(range.current).toMatchObject({ startDate: '2026-09-24', days: 1 });
    expect(range.previous).toMatchObject({ startDate: '2026-09-23', days: 1 });
  });

  it('esta semana: lunes a domingo; la anterior es la semana calendario previa', () => {
    const range = resolveReportRange('week', TZ, now);
    expect(range.current).toMatchObject({ startDate: '2026-09-21', days: 7 }); // lunes 21
    expect(range.previous).toMatchObject({ startDate: '2026-09-14', days: 7 });
  });

  it('este mes: su largo real (30 días en septiembre); el anterior es agosto completo (31 días), no "30 días atrás"', () => {
    const range = resolveReportRange('month', TZ, now);
    expect(range.current).toMatchObject({ startDate: '2026-09-01', days: 30 });
    expect(range.previous).toMatchObject({ startDate: '2026-08-01', days: 31 });
  });

  it('este año: 2026 (no bisiesto, 365 días); el anterior es 2025 completo', () => {
    const range = resolveReportRange('year', TZ, now);
    expect(range.current).toMatchObject({ startDate: '2026-01-01', days: 365 });
    expect(range.previous).toMatchObject({ startDate: '2025-01-01', days: 365 });
  });

  it('rango personalizado: el anterior tiene la MISMA duración, justo antes', () => {
    const range = resolveReportRange('custom', TZ, now, { from: '2026-09-10', to: '2026-09-19' }); // 10 días
    expect(range.current).toMatchObject({ startDate: '2026-09-10', days: 10 });
    expect(range.previous).toMatchObject({ startDate: '2026-08-31', days: 10 });
  });

  it('rango personalizado inválido (sin fechas, o "hasta" antes de "desde") lanza un error claro', () => {
    expect(() => resolveReportRange('custom', TZ, now)).toThrow('invalid_date_range');
    expect(() => resolveReportRange('custom', TZ, now, { from: '2026-09-19', to: '2026-09-10' })).toThrow('invalid_date_range');
  });
});

interface SaleFixture {
  status: 'completed' | 'voided';
  total: number;
  clientName: string;
  createdAt: string;
  items: Array<{ kind: 'service' | 'product'; name: string; quantity: number; total: number; employeeId: string | null; employeeName: string | null }>;
  payments: Array<{ method: string; amount: number }>;
}
function sale(over: Partial<SaleFixture> = {}): SaleFixture {
  return { status: 'completed', total: 30_000, clientName: 'Ana', createdAt: at('20'), items: [{ kind: 'service', name: 'Corte', quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos' }], payments: [{ method: 'cash', amount: 30_000 }], ...over };
}

describe('reportes: agregados a partir de ventas (reemplaza el cálculo por service_records)', () => {
  it('salesSummary: suma total y cuenta LÍNEAS vendidas, ignorando ventas anuladas', () => {
    const sales = [
      sale({ total: 30_000, items: [{ kind: 'service', name: 'Corte', quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos' }] }),
      sale({ total: 50_000, items: [{ kind: 'service', name: 'Tinte', quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos' }, { kind: 'product', name: 'Shampoo', quantity: 1, total: 20_000, employeeId: null, employeeName: null }] }),
      sale({ status: 'voided', total: 999_999 }),
    ];
    expect(salesSummary(sales)).toEqual({ total: 80_000, count: 3, average: Math.round(80_000 / 3) });
    expect(salesSummary([])).toEqual({ total: 0, count: 0, average: null });
  });

  it('paymentMethodBreakdown: desglosa por forma de pago con porcentaje, ignora anuladas', () => {
    const sales = [sale({ payments: [{ method: 'cash', amount: 30_000 }] }), sale({ payments: [{ method: 'nequi', amount: 20_000 }, { method: 'cash', amount: 10_000 }] }), sale({ status: 'voided', payments: [{ method: 'card', amount: 999_999 }] })];
    const rows = paymentMethodBreakdown(sales);
    expect(rows).toEqual([
      { method: 'cash', total: 40_000, count: 2, percent: 67 },
      { method: 'nequi', total: 20_000, count: 1, percent: 33 },
    ]);
  });

  it('employeePerformance: solo cuenta líneas CON empleado asignado; participación porcentual sobre el total con empleado', () => {
    const sales = [
      sale({ items: [{ kind: 'service', name: 'Corte', quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos' }] }),
      sale({ items: [{ kind: 'service', name: 'Tinte', quantity: 1, total: 70_000, employeeId: 'e2', employeeName: 'Laura' }, { kind: 'product', name: 'Shampoo', quantity: 1, total: 20_000, employeeId: null, employeeName: null }] }),
    ];
    expect(employeePerformance(sales)).toEqual([
      { employeeId: 'e2', employeeName: 'Laura', count: 1, total: 70_000, percent: 70 },
      { employeeId: 'e1', employeeName: 'Carlos', count: 1, total: 30_000, percent: 30 },
    ]);
  });

  it('topSaleItems: separa servicios de productos, cuenta por cantidad vendida', () => {
    const sales = [
      sale({ items: [{ kind: 'service', name: 'Corte', quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos' }, { kind: 'product', name: 'Shampoo', quantity: 2, total: 40_000, employeeId: null, employeeName: null }] }),
      sale({ items: [{ kind: 'product', name: 'Shampoo', quantity: 1, total: 20_000, employeeId: null, employeeName: null }] }),
    ];
    expect(topSaleItems(sales, 'service')).toEqual([{ label: 'Corte', count: 1, total: 30_000 }]);
    expect(topSaleItems(sales, 'product')).toEqual([{ label: 'Shampoo', count: 3, total: 60_000 }]);
  });

  it('topSaleClients: ordena por monto gastado, ignora anuladas', () => {
    const sales = [sale({ clientName: 'Ana', total: 30_000 }), sale({ clientName: 'Beto', total: 80_000 }), sale({ clientName: 'Beto', status: 'voided', total: 999_999 })];
    expect(topSaleClients(sales)).toEqual([{ label: 'Beto', count: 1, total: 80_000 }, { label: 'Ana', count: 1, total: 30_000 }]);
  });

  it('reportBuckets: por día en ventanas cortas; por mes en ventanas largas (>35 días)', () => {
    const weekWindow = resolveReportRange('week', TZ, now).current;
    const daily = reportBuckets([sale({ createdAt: at('21'), total: 10_000 })], TZ, weekWindow);
    expect(daily).toHaveLength(7);
    expect(daily.find((b) => b.key === '2026-09-21')).toMatchObject({ total: 10_000, count: 1 });

    const yearWindow = resolveReportRange('year', TZ, now).current;
    const monthly = reportBuckets([sale({ createdAt: at('21'), total: 10_000 })], TZ, yearWindow);
    expect(monthly).toHaveLength(12);
    expect(monthly.find((b) => b.key === '2026-09')).toMatchObject({ total: 10_000, count: 1 });
  });

  it('openingBaseTotal: suma las bases de caja del periodo; 0 si ningún día se abrió (nunca inventa un valor)', () => {
    expect(openingBaseTotal([{ amount: 25_000 }, { amount: 30_000 }])).toBe(55_000);
    expect(openingBaseTotal([])).toBe(0);
  });

  it('cashBalance: base inicial + ventas en efectivo (ignora otras formas de pago)', () => {
    const methods = paymentMethodBreakdown([sale({ payments: [{ method: 'cash', amount: 30_000 }] }), sale({ payments: [{ method: 'nequi', amount: 20_000 }] })]);
    expect(cashBalance(25_000, methods)).toBe(55_000); // 25.000 base + 30.000 en efectivo (los 20.000 de Nequi no cuentan)
    expect(cashBalance(0, [])).toBe(0);
  });
});
