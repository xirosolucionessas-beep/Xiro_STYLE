import { readFileSync } from 'node:fs';
import path from 'node:path';
import { translate, type CashClosingDto, type CashDaySummary } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { afterCloseNote, dailyCashFlow, flowShares, unbilledNote } from '../src/lib/cashFlow';

/** Inicio → "Flujo de caja diario": neto = cobrado (todos los métodos) − gastos del día; caja abierta = efectivo vs. base. */
const summary = (over: Partial<CashDaySummary> = {}): CashDaySummary => ({
  day: '2026-10-13',
  opening: 200000,
  salesByMethod: [
    { method: 'card', total: 80000, count: 2 },
    { method: 'cash', total: 50000, count: 1 },
    { method: 'nequi', total: 0, count: 0 },
  ],
  totalSales: 130000,
  totalTip: 5000,
  servicesCount: 3,
  productsCount: 0,
  topServices: [],
  topProducts: [],
  employeeSales: [],
  expenses: [],
  totalExpenses: 45000,
  adjustmentsAfterClose: [],
  afterClose: null,
  unbilledRecords: { count: 0, total: 0 },
  expectedCash: 205000,
  hourly: [],
  clientsServed: 3,
  newClients: 0,
  appointments: { completed: 0, cancelled: 0, noShow: 0 },
  ...over,
});
const closing = (status: CashClosingDto['status'], day = '2026-10-13') => ({ day, status }) as CashClosingDto;
const read = (file: string) => readFileSync(path.resolve(__dirname, '../src', file), 'utf8');

describe('flujo de caja del día', () => {
  it('neto = entradas (todos los métodos, con propinas) − gastos; métodos sin cobro no se muestran', () => {
    const flow = dailyCashFlow(summary());
    expect(flow).toMatchObject({ income: 130000, tips: 5000, expenses: 45000, net: 85000 });
    expect(flow.methods).toEqual([
      { method: 'card', total: 80000 },
      { method: 'cash', total: 50000 },
    ]);
  });

  it('caja abierta: efectivo actual (base + efectivo − gastos de caja) frente a la base', () => {
    expect(dailyCashFlow(summary()).cash).toEqual({ state: 'open', opening: 200000, current: 205000 });
  });

  it('sin abrir, o ya cerrada hoy (un cierre anulado no cuenta como cerrada)', () => {
    expect(dailyCashFlow(summary({ opening: null, expectedCash: null })).cash).toEqual({ state: 'not_opened' });
    expect(dailyCashFlow(summary(), [closing('completed')]).cash).toEqual({ state: 'closed', opening: 200000 });
    expect(dailyCashFlow(summary(), [closing('voided')]).cash.state).toBe('open');
    expect(dailyCashFlow(summary(), [closing('completed', '2026-10-12')]).cash.state).toBe('open');
  });

  it('un día con más gastos que entradas da neto negativo', () => {
    expect(dailyCashFlow(summary({ totalSales: 0, salesByMethod: [], totalTip: 0, totalExpenses: 45000 })).net).toBe(-45000);
  });

  it('la barra reparte entradas y gastos; sin movimiento, las dos en cero', () => {
    expect(flowShares({ income: 75, expenses: 25 })).toEqual({ income: 0.75, expenses: 0.25 });
    expect(flowShares({ income: 0, expenses: 0 })).toEqual({ income: 0, expenses: 0 });
  });
});

describe('tarjeta en el Inicio', () => {
  it('solo la ve el dueño (web y Android/iOS), igual que el resumen de caja en el servidor', () => {
    expect(read('app/(app)/(tabs)/index.web.tsx')).toMatch(/const cashFlow: CashFlowView \| null = isOwner/);
    expect(read('app/(app)/(tabs)/index.tsx')).toMatch(/\{isOwner \? \(\s*<CashFlowCard/);
  });

  it('cada texto existe en español e inglés', () => {
    const source = read('ui/home/CashFlowCard.tsx') + read('web/screens/Dashboard.tsx');
    const keys = new Set([...source.matchAll(/\bt\('(home_cf_[a-z_]+)'/g)].map((m) => m[1]!));
    expect(keys.size).toBeGreaterThan(10);
    const missing = [...keys].flatMap((key) => (['es', 'en'] as const).filter((lang) => translate(lang, key) === key).map((lang) => `${lang}:${key}`));
    expect(missing).toEqual([]);
  });
});

describe('después del cierre', () => {
  const money = (n: number) => `$${n}`;
  const t = (key: string, params?: Record<string, string | number>) => translate('es', key, params);
  const after = { closedAt: '2026-10-13T23:00:00Z', closedSales: 100000, closedExpectedCash: 150000 };

  it('explica lo que cambió tras firmar (ventas nuevas suman, anuladas restan) y no dice nada si nada cambió', () => {
    expect(afterCloseNote({ ...after, salesDelta: 30000, expectedCashDelta: 30000 }, money, t)).toBe('Después del cierre: ventas +$30000 · efectivo esperado +$30000. El cierre firmado no cambia.');
    expect(afterCloseNote({ ...after, salesDelta: -20000, expectedCashDelta: 0 }, money, t)).toContain('ventas $-20000');
    expect(afterCloseNote({ ...after, salesDelta: 0, expectedCashDelta: 0 }, money, t)).toBeNull();
    expect(afterCloseNote(null, money, t)).toBeNull();
  });

  it('la tarjeta del Inicio solo lo lleva con la caja de hoy cerrada', () => {
    const changed = { ...after, salesDelta: 30000, expectedCashDelta: 30000 };
    expect(dailyCashFlow(summary({ afterClose: changed }), [closing('completed')]).afterClose).toEqual(changed);
    expect(dailyCashFlow(summary({ afterClose: changed })).afterClose).toBeNull();
  });

  it('se muestra en el Cierre de caja (web y Android/iOS) y en el Inicio', () => {
    expect(read('app/(app)/cash-close.web.tsx')).toContain('afterClose: afterCloseNote(summary?.afterClose ?? null, money, t)');
    expect(read('app/(app)/cash-close.tsx')).toContain('afterCloseNote(summary?.afterClose ?? null, fmt, t)');
    for (const lang of ['es', 'en'] as const) expect(translate(lang, 'cash_after_close')).not.toBe('cash_after_close');
  });
});

describe('cobros sin venta registrada (citas completadas, servicios a mano)', () => {
  const money = (n: number) => `$${n}`;
  const t = (key: string, params?: Record<string, string | number>) => translate('es', key, params);

  it('se explican aparte y no tocan las entradas de la caja', () => {
    const flow = dailyCashFlow(summary({ unbilledRecords: { count: 2, total: 45000 } }));
    expect(flow.income).toBe(130000); // las entradas siguen siendo solo lo cobrado en ventas
    expect(flow.unbilled).toEqual({ count: 2, total: 45000 });
    expect(unbilledNote(flow.unbilled, money, t)).toBe('Cobros sin venta registrada (citas completadas o servicios registrados a mano): $45000. No suman a las ventas ni al efectivo de la caja.');
    expect(unbilledNote({ count: 1, total: 15000 }, money, t)).toContain('1 cobro sin venta registrada');
    expect(unbilledNote({ count: 0, total: 0 }, money, t)).toBeNull();
  });

  it('se muestra en el Cierre de caja (web y Android/iOS) y en el Inicio (web y Android/iOS)', () => {
    expect(read('app/(app)/cash-close.web.tsx')).toContain('unbilledNote={unbilledNote(summary?.unbilledRecords, money, t)}');
    expect(read('app/(app)/cash-close.tsx')).toContain('unbilledNote(summary?.unbilledRecords, fmt, t)');
    expect(read('app/(app)/(tabs)/index.web.tsx')).toContain('unbilledNote: unbilledNote(flow.unbilled, money, t)');
    expect(read('ui/home/CashFlowCard.tsx')).toContain('unbilledNote(flow.unbilled, money, t)');
  });
});

describe('nómina a empleados inactivos', () => {
  it('el formulario los ofrece (después de los activos) marcados como inactivos', () => {
    const source = read('app/(app)/expenses.tsx');
    expect(source).toContain('.sort((x, y) => Number(y.active) - Number(x.active))');
    expect(source).not.toContain('.filter((p) => p.active || p.id === employeeId)');
    for (const lang of ['es', 'en'] as const) for (const key of ['exp_employee_inactive', 'expense_date_future', 'cash_unbilled', 'cash_unbilled_one']) expect(translate(lang, key), key).not.toBe(key);
  });
});
