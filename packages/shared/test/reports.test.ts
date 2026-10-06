import { describe, expect, it } from 'vitest';
import type { SaleDto } from '../src/sales';
import { cashBalance, employeePerformance, openingBaseTotal, paymentMethodBreakdown, reportBuckets, resolveReportRange, salesSummary, topSaleClients, topSaleItems } from '../src/reports';

const TZ = 'America/Bogota';
const now = new Date('2026-09-24T20:00:00Z'); // 24 sep, 15:00 en Bogotá
const at = (day: string, hour = 15) => `2026-09-${day}T${String(hour + 5).padStart(2, '0')}:00:00Z`;

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

function sale(over: Partial<SaleDto> = {}): Pick<SaleDto, 'status' | 'total' | 'clientName' | 'createdAt' | 'items' | 'payments'> {
  return {
    status: 'completed',
    total: 30_000,
    clientName: 'Ana',
    createdAt: at('20'),
    items: [{ id: 'i1', kind: 'service', itemId: null, name: 'Corte', unitPrice: 30_000, quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos', loyaltyCounted: true }],
    payments: [{ id: 'p1', method: 'cash', amount: 30_000, receivedAmount: null }],
    ...over,
  };
}

describe('reportes: agregados a partir de ventas — misma fuente para el panel y el asistente de IA', () => {
  it('salesSummary: suma total y cuenta LÍNEAS vendidas, ignorando ventas anuladas', () => {
    const sales = [
      sale({ total: 30_000, items: [{ id: 'i1', kind: 'service', itemId: null, name: 'Corte', unitPrice: 30_000, quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos', loyaltyCounted: true }] }),
      sale({
        total: 50_000,
        items: [
          { id: 'i2', kind: 'service', itemId: null, name: 'Tinte', unitPrice: 30_000, quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos', loyaltyCounted: true },
          { id: 'i3', kind: 'product', itemId: null, name: 'Shampoo', unitPrice: 20_000, quantity: 1, total: 20_000, employeeId: null, employeeName: null, loyaltyCounted: false },
        ],
      }),
      sale({ status: 'voided', total: 999_999 }),
    ];
    expect(salesSummary(sales)).toEqual({ total: 80_000, count: 3, average: Math.round(80_000 / 3) });
    expect(salesSummary([])).toEqual({ total: 0, count: 0, average: null });
  });

  it('paymentMethodBreakdown: desglosa por forma de pago con porcentaje, ignora anuladas', () => {
    const sales = [
      sale({ payments: [{ id: 'p1', method: 'cash', amount: 30_000, receivedAmount: null }] }),
      sale({
        payments: [
          { id: 'p2', method: 'nequi', amount: 20_000, receivedAmount: null },
          { id: 'p3', method: 'cash', amount: 10_000, receivedAmount: null },
        ],
      }),
      sale({ status: 'voided', payments: [{ id: 'p4', method: 'card', amount: 999_999, receivedAmount: null }] }),
    ];
    const rows = paymentMethodBreakdown(sales);
    expect(rows).toEqual([
      { method: 'cash', total: 40_000, count: 2, percent: 67 },
      { method: 'nequi', total: 20_000, count: 1, percent: 33 },
    ]);
  });

  it('employeePerformance: solo cuenta líneas CON empleado asignado; participación porcentual sobre el total con empleado', () => {
    const sales = [
      sale({ items: [{ id: 'i1', kind: 'service', itemId: null, name: 'Corte', unitPrice: 30_000, quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos', loyaltyCounted: true }] }),
      sale({
        items: [
          { id: 'i2', kind: 'service', itemId: null, name: 'Tinte', unitPrice: 70_000, quantity: 1, total: 70_000, employeeId: 'e2', employeeName: 'Laura', loyaltyCounted: true },
          { id: 'i3', kind: 'product', itemId: null, name: 'Shampoo', unitPrice: 20_000, quantity: 1, total: 20_000, employeeId: null, employeeName: null, loyaltyCounted: false },
        ],
      }),
    ];
    expect(employeePerformance(sales)).toEqual([
      { employeeId: 'e2', employeeName: 'Laura', count: 1, total: 70_000, percent: 70 },
      { employeeId: 'e1', employeeName: 'Carlos', count: 1, total: 30_000, percent: 30 },
    ]);
  });

  it('topSaleItems: separa servicios de productos, cuenta por cantidad vendida', () => {
    const sales = [
      sale({
        items: [
          { id: 'i1', kind: 'service', itemId: null, name: 'Corte', unitPrice: 30_000, quantity: 1, total: 30_000, employeeId: 'e1', employeeName: 'Carlos', loyaltyCounted: true },
          { id: 'i2', kind: 'product', itemId: null, name: 'Shampoo', unitPrice: 20_000, quantity: 2, total: 40_000, employeeId: null, employeeName: null, loyaltyCounted: false },
        ],
      }),
      sale({ items: [{ id: 'i3', kind: 'product', itemId: null, name: 'Shampoo', unitPrice: 20_000, quantity: 1, total: 20_000, employeeId: null, employeeName: null, loyaltyCounted: false }] }),
    ];
    expect(topSaleItems(sales, 'service')).toEqual([{ label: 'Corte', count: 1, total: 30_000 }]);
    expect(topSaleItems(sales, 'product')).toEqual([{ label: 'Shampoo', count: 3, total: 60_000 }]);
  });

  it('topSaleClients: ordena por monto gastado, ignora anuladas', () => {
    const sales = [sale({ clientName: 'Ana', total: 30_000 }), sale({ clientName: 'Beto', total: 80_000 }), sale({ clientName: 'Beto', status: 'voided', total: 999_999 })];
    expect(topSaleClients(sales)).toEqual([
      { label: 'Beto', count: 1, total: 80_000 },
      { label: 'Ana', count: 1, total: 30_000 },
    ]);
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
    const methods = paymentMethodBreakdown([sale({ payments: [{ id: 'p1', method: 'cash', amount: 30_000, receivedAmount: null }] }), sale({ payments: [{ id: 'p2', method: 'nequi', amount: 20_000, receivedAmount: null }] })]);
    expect(cashBalance(25_000, methods)).toBe(55_000); // 25.000 base + 30.000 en efectivo (los 20.000 de Nequi no cuentan)
    expect(cashBalance(0, [])).toBe(0);
  });
});
