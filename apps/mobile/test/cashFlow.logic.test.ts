import { readFileSync } from 'node:fs';
import path from 'node:path';
import { translate, type CashClosingDto, type CashDaySummary } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { dailyCashFlow, flowShares } from '../src/lib/cashFlow';

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
