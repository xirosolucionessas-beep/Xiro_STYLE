import { employeeQuota, formatMoney, translate, type CashEmployeeBreakdownSummary } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { breakdownView, CASH_LIVE_INTERVAL_MS, liveStatus, liveStatusText } from '../src/lib/cashBreakdown';
import { quotaView } from '../src/lib/employeesLogic';

/** Cierre de caja: textos del desglose por empleado, estado de la actualización automática y cupos de empleados. */
const t = (key: string, params?: Record<string, string | number>) => translate('es', key, params);
const fmt = (n: number) => formatMoney(n, 'COP');

const breakdown: CashEmployeeBreakdownSummary = {
  employees: [
    {
      employeeId: 'ana',
      employeeName: 'Ana',
      serviceUnits: 4,
      services: [{ name: 'Corte', units: 4, gross: 80000, discount: 4201, net: 75799 }],
      gross: 80000,
      discount: 4201,
      net: 75799,
    },
  ],
  unattributed: { serviceUnits: 0, services: [], productUnits: 2, products: [{ name: 'Champú', units: 2, gross: 10000, discount: 700, net: 9300 }], gross: 10000, discount: 700, net: 9300 },
  totals: { gross: 90000, discount: 4901, net: 85099, tip: 5000, total: 90099 },
};

describe('desglose por empleado (vista)', () => {
  it('muestra bruto, descuento y neto por separado, con unidades y servicios', () => {
    const view = breakdownView(t, fmt, breakdown);
    expect(view.employees[0]).toMatchObject({ name: 'Ana', units: '4 servicios', gross: fmt(80000), discount: `−${fmt(4201)}`, net: fmt(75799) });
    expect(view.employees[0]!.lines[0]).toMatchObject({ label: 'Corte ×4', net: fmt(75799) });
    expect(view.unattributed?.products[0]?.label).toBe('Champú ×2');
    expect(view.hasTips).toBe(true);
    expect(view.reconcile).toBe(`Neto ${fmt(85099)} + propinas ${fmt(5000)} = ventas del día ${fmt(90099)}`);
  });

  it('sin ventas no inventa cifras', () => {
    const view = breakdownView(t, fmt, { employees: [], unattributed: { serviceUnits: 0, services: [], productUnits: 0, products: [], gross: 0, discount: 0, net: 0 }, totals: { gross: 0, discount: 0, net: 0, tip: 0, total: 0 } });
    expect(view).toMatchObject({ empty: true, employees: [], unattributed: null, hasTips: false });
  });

  it('una sola unidad usa singular', () => {
    const view = breakdownView(t, fmt, { ...breakdown, employees: [{ ...breakdown.employees[0]!, serviceUnits: 1 }] });
    expect(view.employees[0]!.units).toBe('1 servicio');
  });
});

describe('estado de la actualización automática', () => {
  const base = { live: true, active: true, hasData: true, isFetching: false, isError: false, dataUpdatedAt: 1_000_000, now: 1_000_000 };
  it('distingue carga inicial, actualización, al día, desactualizado, error con datos, fallo, pausa y día pasado', () => {
    expect(liveStatus({ ...base, hasData: false, isFetching: true })).toBe('initial');
    expect(liveStatus({ ...base, hasData: false, isError: true })).toBe('failed');
    expect(liveStatus({ ...base, isFetching: true })).toBe('refreshing');
    expect(liveStatus(base)).toBe('fresh');
    expect(liveStatus({ ...base, now: base.now + CASH_LIVE_INTERVAL_MS * 2 + 1 })).toBe('stale');
    expect(liveStatus({ ...base, isError: true })).toBe('error');
    expect(liveStatus({ ...base, active: false })).toBe('paused');
    expect(liveStatus({ ...base, live: false })).toBe('static');
  });

  it('dice que es automático y cada cuánto, sin llamarlo tiempo real', () => {
    const text = liveStatusText(t, 'fresh', '10:32 a. m.');
    expect(text).toContain('Actualizado a las 10:32 a. m.');
    expect(text).toContain('cada 30 s');
    expect(text.toLowerCase()).not.toContain('tiempo real');
    expect(liveStatusText(t, 'error', '10:32 a. m.')).toContain('Se muestran los datos de las 10:32 a. m.');
    expect(liveStatusText(t, 'static', '')).toContain('no se actualizan solas');
  });

  it('textos en inglés también existen', () => {
    const en = (key: string, params?: Record<string, string | number>) => translate('en', key, params);
    expect(liveStatusText(en, 'fresh', '10:32 AM')).toContain('Updated at 10:32 AM');
    expect(breakdownView(en, fmt, breakdown).employees[0]!.units).toBe('4 services');
  });
});

describe('cupos de empleados', () => {
  it('muestra "3 de 5" y los cupos libres; deshabilita al llegar al límite', () => {
    expect(quotaView(t, employeeQuota(3))).toMatchObject({ title: '3 de 5 empleados activos', full: false });
    expect(quotaView(t, employeeQuota(3)).detail).toContain('Te quedan 2 cupos.');
    expect(quotaView(t, employeeQuota(4)).detail).toContain('Te queda 1 cupo.');
    expect(quotaView(t, employeeQuota(5))).toMatchObject({ title: '5 de 5 empleados activos', full: true });
    expect(quotaView(t, employeeQuota(5)).detail).toContain('No quedan cupos');
  });

  it('negocio por encima del límite: se informa sin quitar a nadie', () => {
    const view = quotaView(t, employeeQuota(7));
    expect(view).toMatchObject({ title: '7 de 5 empleados activos', full: true });
    expect(view.detail).toContain('Nadie pierde acceso');
    expect(view.detail).toContain('Tu cuenta de dueño no cuenta');
  });

  it('el error del servidor tiene texto en ambos idiomas', () => {
    expect(translate('es', 'employee_limit_reached')).toContain('máximo de 5');
    expect(translate('en', 'employee_limit_reached')).toContain('maximum of 5');
  });
});
