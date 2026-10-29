import { formatMoney, translate, type CashDaySaleDto, type ExpenseDto } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { adjustmentText, expenseDetailView, groupExpensesByBeneficiary, saleDetailView, type DetailFormat } from '../src/lib/cashDetail';

/** "Ver más" del cierre: cómo se muestra cada venta y gasto (fechas del servidor en la zona del negocio, importes guardados). */
const t = (key: string, params?: Record<string, string | number>) => translate('es', key, params);
const fmt = (n: number) => formatMoney(n, 'COP');
const f: DetailFormat = { t, fmt, timezone: 'America/Bogota', language: 'es' };

const sale = (patch: Partial<CashDaySaleDto['sale']> = {}): CashDaySaleDto => ({
  sale: {
    id: 's1',
    clientId: 'c1',
    clientName: 'Marta Ruiz',
    items: [
      { id: 'i1', kind: 'service', itemId: null, name: 'Corte', unitPrice: 20000, quantity: 3, total: 60000, employeeId: 'ana', employeeName: 'Ana', loyaltyCounted: false },
      { id: 'i2', kind: 'service', itemId: null, name: 'Tinte', unitPrice: 30000, quantity: 1, total: 30000, employeeId: 'luis', employeeName: 'Luis', loyaltyCounted: false },
      { id: 'i3', kind: 'product', itemId: null, name: 'Champú', unitPrice: 5000, quantity: 2, total: 10000, employeeId: null, employeeName: null, loyaltyCounted: false },
    ],
    payments: [
      { id: 'p1', method: 'cash', amount: 50000, receivedAmount: 60000 },
      { id: 'p2', method: 'nequi', amount: 47999, receivedAmount: null },
    ],
    subtotal: 100000,
    discount: 7001,
    tip: 5000,
    total: 97999,
    changeGiven: 10000,
    status: 'completed',
    voidReason: '',
    createdByName: 'Dueña',
    // 23:30 UTC = 18:30 en Bogotá (UTC−5), el mismo día local.
    createdAt: '2026-10-19T23:30:00.000Z',
    rewardJustEarned: false,
    ...patch,
  },
  lines: [{ id: 'i1', kind: 'service', name: 'Corte', quantity: 3, unitPrice: 20000, gross: 60000, discountShare: 4201, net: 55799 }],
  gross: 60000,
  discountShare: 4201,
  net: 55799,
});

describe('detalle de una venta', () => {
  it('fecha y hora del servidor en la zona del negocio; cliente; quién registró separado de quién realizó', () => {
    const view = saleDetailView(f, sale());
    expect(view.when).toContain('19 oct');
    expect(view.when).toContain('6:30');
    expect(view.client).toBe('Cliente: Marta Ruiz');
    expect(view.registeredBy).toBe('Registró la venta: Dueña');
    expect(view.lines).toEqual([{ key: 'i1', label: 'Corte ×3', gross: fmt(60000), discount: `−${fmt(4201)}`, net: fmt(55799) }]);
    // Las demás líneas de la venta se ven con quién las realizó; el producto, sin empleado.
    expect(view.otherLines.map((l) => [l.label, l.performer])).toEqual([
      [`Tinte ×1 · ${fmt(30000)}`, 'Realizó: Luis'],
      [`Champú ×2 · ${fmt(10000)}`, null],
    ]);
  });

  it('venta completa: subtotal, descuento guardado, propina aparte, total, pagos divididos y cambio', () => {
    const view = saleDetailView(f, sale());
    expect(view.sale).toEqual({
      subtotal: fmt(100000),
      discount: `−${fmt(7001)}`,
      tip: fmt(5000),
      total: fmt(97999),
      change: fmt(10000),
      payments: [
        { key: 'p1', label: 'Efectivo', amount: fmt(50000) },
        { key: 'p2', label: 'Nequi', amount: fmt(47999) },
      ],
    });
  });

  it('cliente ocasional, sin propina, y anulada marcada con su motivo', () => {
    const view = saleDetailView(f, sale({ clientId: null, clientName: '', tip: 0, changeGiven: 0, status: 'voided', voidReason: 'Error de cobro' }));
    expect(view.client).toBe('Cliente: Cliente ocasional');
    expect(view.sale.tip).toBeNull();
    expect(view.sale.change).toBeNull();
    expect(view.voided).toBe(true);
    expect(view.voidReason).toBe('Motivo: Error de cobro');
  });
});

const expense = (patch: Partial<ExpenseDto> = {}): ExpenseDto => ({
  id: 'e1',
  amount: 300000,
  description: 'Pago quincena',
  method: 'bank_transfer',
  createdByName: 'Dueña',
  createdAt: '2026-10-19T14:05:00.000Z',
  type: 'payroll',
  category: 'salary',
  expenseDate: '2026-10-19',
  employeeId: 'ana',
  employeeName: 'Ana',
  notes: '',
  paidFromCash: false,
  status: 'active',
  voidReason: '',
  voidedByName: null,
  voidedAt: null,
  updatedAt: '2026-10-19T14:05:00.000Z',
  cashDayClosed: false,
  ...patch,
} as ExpenseDto);

describe('detalle de un gasto', () => {
  it('distingue quién lo registró de a quién se le pagó, con fecha del gasto y hora de registro', () => {
    const view = expenseDetailView(f, expense());
    expect(view.registered).toContain('Registrado por Dueña');
    expect(view.registered).toContain('9:05');
    expect(view.beneficiary).toBe('Empleado beneficiario: Ana');
    expect(view.expenseDate).toMatch(/19 de oct/);
    expect(view.fromCash).toBe('No salió del efectivo de caja');
    expect(view.voided).toBe(false);
  });

  it('anulado: marcado con quién, cuándo y motivo', () => {
    const view = expenseDetailView(f, expense({ status: 'voided', voidReason: 'Duplicado', voidedByName: 'Dueña', voidedAt: '2026-10-19T20:00:00.000Z', paidFromCash: true, method: 'cash' }));
    expect(view.voided).toBe(true);
    expect(view.voidInfo).toContain('Anulado por Dueña');
    expect(view.voidInfo).toContain('Duplicado');
    expect(view.fromCash).toBe('Salió del efectivo de caja');
  });

  it('agrupa por empleado beneficiario; sin beneficiario al final', () => {
    const groups = groupExpensesByBeneficiary(t, [expense({ id: 'a', employeeId: null, employeeName: null }), expense({ id: 'b' }), expense({ id: 'c', employeeId: 'luis', employeeName: 'Luis' })]);
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ['Pagado a: Ana', ['b']],
      ['Pagado a: Luis', ['c']],
      ['Sin empleado beneficiario', ['a']],
    ]);
  });

  it('ajuste posterior al cierre: quién, cuándo, tipo, antes → después y motivo', () => {
    const text = adjustmentText(f, { id: 'x', expenseId: 'e1', cashDay: '2026-10-19', kind: 'edit', reason: 'Monto mal digitado', amountBefore: 50000, amountAfter: 45000, createdByName: 'Dueña', createdAt: '2026-10-20T13:00:00.000Z' });
    const plain = (s: string) => s.replace(/\s/g, ' ');
    expect(plain(text)).toContain('Dueña · Mar, 20 oct 2026 · 8:00 a. m. · corrección');
    expect(plain(text)).toContain(plain(`${fmt(50000)} → ${fmt(45000)}. Motivo: Monto mal digitado`));
  });
});
