import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { formatMoney, translate, type CashDaySalesPage } from '@xiro/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { CASH_LIVE_INTERVAL_MS } from '../src/lib/cashBreakdown';
import { useCashDetail, type CashDetailTarget, type CashExpensesDetailModel, type CashSalesDetailModel } from '../src/lib/useCashDetail';
import { useLiveRefresh } from '../src/lib/useLiveRefresh.web';
import { CashExpensesDetailModal, CashSalesDetailModal } from '../src/web/screens/CashCloseDetail';

/** "Ver más" del cierre de caja (web): estados, contenido, accesibilidad y actualización automática del detalle abierto. */
vi.mock('../src/lib/api', () => ({ api: { cashDaySales: vi.fn(), expensesPage: vi.fn() }, fetchAllPages: vi.fn() }));
let focused = true;
vi.mock('expo-router', () => ({ useIsFocused: () => focused }));

const t = (key: string, params?: Record<string, string | number>) => translate('es', key, params);
const fmt = (n: number) => formatMoney(n, 'COP');

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

const salesModel = (patch: Partial<CashSalesDetailModel> = {}): CashSalesDetailModel => ({
  state: 'ready',
  refreshError: false,
  summary: '2 ventas completadas · 1 anuladas (no suman)',
  showing: null,
  rows: [
    {
      id: 's1',
      when: 'Lun, 19 oct 2026 · 6:30 p. m.',
      client: 'Cliente: Marta Ruiz',
      registeredBy: 'Registró la venta: Dueña',
      voided: false,
      voidReason: null,
      lines: [{ key: 'i1', label: 'Corte ×3', gross: fmt(60000), discount: `−${fmt(4201)}`, net: fmt(55799) }],
      totals: { gross: fmt(60000), discount: `−${fmt(4201)}`, net: fmt(55799) },
      otherLines: [{ key: 'i3', label: `Champú ×2 · ${fmt(10000)}`, performer: null }],
      sale: { subtotal: fmt(100000), discount: `−${fmt(7001)}`, tip: fmt(5000), total: fmt(97999), change: null, payments: [{ key: 'p1', label: 'Efectivo', amount: fmt(50000) }, { key: 'p2', label: 'Nequi', amount: fmt(47999) }] },
    },
    {
      id: 's2',
      when: 'Lun, 19 oct 2026 · 7:00 p. m.',
      client: 'Cliente: Cliente ocasional',
      registeredBy: 'Registró la venta: Ana',
      voided: true,
      voidReason: 'Motivo: Error',
      lines: [{ key: 'i9', label: 'Corte ×1', gross: fmt(20000), discount: fmt(0), net: fmt(20000) }],
      totals: { gross: fmt(20000), discount: fmt(0), net: fmt(20000) },
      otherLines: [],
      sale: { subtotal: fmt(20000), discount: fmt(0), tip: null, total: fmt(20000), change: null, payments: [{ key: 'p9', label: 'Efectivo', amount: fmt(20000) }] },
    },
  ],
  hasMore: false,
  loadingMore: false,
  loadMore: vi.fn(),
  retry: vi.fn(),
  updatedAt: 1,
  ...patch,
});

describe('detalle de ventas (modal web)', () => {
  it('cada venta con fecha, cliente, quién registró, líneas con descuento distribuido, propina aparte y pagos; anulada marcada', async () => {
    render(<CashSalesDetailModal open onClose={vi.fn()} t={t} title="Ventas de Ana · hoy" aggregate={{ gross: fmt(80000), discount: `−${fmt(4201)}`, net: fmt(75799) }} updated="6:31 p. m." model={salesModel()} />);
    const dialog = screen.getByRole('dialog', { name: 'Ventas de Ana · hoy' });
    expect(within(dialog).getByText('Lun, 19 oct 2026 · 6:30 p. m.')).toBeTruthy();
    expect(within(dialog).getByText('Cliente: Marta Ruiz')).toBeTruthy();
    expect(within(dialog).getByText('Registró la venta: Dueña')).toBeTruthy();
    expect(within(dialog).getAllByText(/Descuento distribuido/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Propina (no asignada a ningún empleado)')).toBeTruthy();
    expect(within(dialog).getByText('Pagos · Nequi')).toBeTruthy();
    expect(within(dialog).getByText('Anulada · no suma en los totales')).toBeTruthy();
    expect(within(dialog).getByText('Detalle actualizado a las 6:31 p. m.')).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/ganancia|comisión/i);
    await noViolations(dialog);
  });

  it('estados: carga, error con reintento, vacío, y error al actualizar conservando los datos', async () => {
    const retry = vi.fn();
    const { rerender } = render(<CashSalesDetailModal open onClose={vi.fn()} t={t} title="Detalle" updated={null} model={salesModel({ state: 'loading', rows: [] })} />);
    expect(screen.getByText('Cargando el detalle…')).toBeTruthy();
    rerender(<CashSalesDetailModal open onClose={vi.fn()} t={t} title="Detalle" updated={null} model={salesModel({ state: 'error', rows: [], retry })} />);
    expect(screen.getByText('No se pudo cargar el detalle.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<CashSalesDetailModal open onClose={vi.fn()} t={t} title="Detalle" updated={null} model={salesModel({ state: 'empty', rows: [] })} />);
    expect(screen.getByText('No hay ventas para mostrar en este día.')).toBeTruthy();
    rerender(<CashSalesDetailModal open onClose={vi.fn()} t={t} title="Detalle" updated="6:31 p. m." model={salesModel({ refreshError: true, retry })} />);
    expect(screen.getByText(/No se pudo actualizar/)).toBeTruthy();
    expect(screen.getByText('Cliente: Marta Ruiz')).toBeTruthy();
  });

  it('paginación visible: "Mostrando X de Y" y "Cargar más"', async () => {
    const loadMore = vi.fn();
    render(<CashSalesDetailModal open onClose={vi.fn()} t={t} title="Detalle" updated={null} model={salesModel({ showing: 'Mostrando 2 de 60', hasMore: true, loadMore })} />);
    expect(screen.getByText('Mostrando 2 de 60')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(loadMore).toHaveBeenCalled();
  });

  it('se cierra con Escape (teclado)', async () => {
    const onClose = vi.fn();
    render(<CashSalesDetailModal open onClose={onClose} t={t} title="Detalle" updated={null} model={salesModel()} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('detalle de gastos (modal web)', () => {
  const model = (patch: Partial<CashExpensesDetailModel> = {}): CashExpensesDetailModel => ({
    state: 'ready',
    refreshError: false,
    summary: `1 gastos vigentes · total ${fmt(300000)}`,
    showing: null,
    groups: [
      {
        key: 'ana',
        title: 'Pagado a: Ana',
        items: [{ id: 'e1', title: 'Pago quincena', meta: 'Nómina · Salario', amount: fmt(300000), method: 'Transferencia', expenseDate: 'Fecha del gasto: 19 de oct de 2026', registered: 'Registrado por Dueña a las Lun, 19 oct 2026 · 9:05 a. m.', beneficiary: 'Empleado beneficiario: Ana', fromCash: 'No salió del efectivo de caja', notes: null, voided: false, voidInfo: null }],
      },
      {
        key: '__none__',
        title: 'Sin empleado beneficiario',
        items: [{ id: 'e2', title: 'Insumos', meta: 'Operativo · Insumos', amount: fmt(20000), method: 'Efectivo', expenseDate: 'Fecha del gasto: 19 de oct de 2026', registered: 'Registrado por Luis a las Lun, 19 oct 2026 · 10:00 a. m.', beneficiary: null, fromCash: 'Salió del efectivo de caja', notes: null, voided: true, voidInfo: 'Anulado por Dueña a las … Motivo: Duplicado' }],
      },
    ],
    adjustments: ['Dueña · Mar, 20 oct 2026 · 8:00 a. m. · corrección: $ 50.000 → $ 45.000. Motivo: Monto mal digitado'],
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
    updatedAt: 1,
    ...patch,
  });

  it('agrupa por beneficiario, separa quién registró, marca anulados y muestra ajustes posteriores al cierre', async () => {
    render(<CashExpensesDetailModal open onClose={vi.fn()} t={t} title="Gastos del día" updated="9:10 a. m." model={model()} />);
    const dialog = screen.getByRole('dialog', { name: 'Gastos del día' });
    const ana = within(dialog).getByRole('region', { name: 'Pagado a: Ana' });
    expect(ana.textContent).toContain('Registrado por Dueña');
    expect(ana.textContent).toContain('Empleado beneficiario: Ana');
    const none = within(dialog).getByRole('region', { name: 'Sin empleado beneficiario' });
    expect(within(none).getByText('Anulado · no suma')).toBeTruthy();
    expect(within(dialog).getByRole('region', { name: /Ajustes después del cierre/ }).textContent).toContain('Monto mal digitado');
    await noViolations(dialog);
  });

  it('vacío y error', () => {
    const { rerender } = render(<CashExpensesDetailModal open onClose={vi.fn()} t={t} title="Gastos" updated={null} model={model({ state: 'empty', groups: [], adjustments: [] })} />);
    expect(screen.getByText('No hay gastos registrados en este día.')).toBeTruthy();
    rerender(<CashExpensesDetailModal open onClose={vi.fn()} t={t} title="Gastos" updated={null} model={model({ state: 'error', groups: [], adjustments: [] })} />);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });
});

/* ---------- Actualización automática del detalle abierto ---------- */

const salesPage = (ids: string[]): CashDaySalesPage => ({
  data: ids.map((id) => ({
    sale: { id, clientId: null, clientName: 'Cliente ocasional', items: [], payments: [], subtotal: 20000, discount: 0, tip: 0, total: 20000, changeGiven: 0, status: 'completed', voidReason: '', createdByName: 'Dueña', createdAt: '2026-10-19T20:00:00.000Z', rewardJustEarned: false },
    lines: [],
    gross: 20000,
    discountShare: 0,
    net: 20000,
  })),
  nextCursor: null,
  summary: { completedCount: ids.length, voidedCount: 0, gross: 20000 * ids.length, discountShare: 0, net: 20000 * ids.length, units: ids.length },
});

function Probe({ target, live }: { target: CashDetailTarget | null; live: boolean }) {
  const refresh = useLiveRefresh(live, () => undefined);
  const detail = useCashDetail({ day: '2026-10-19', target, expensesOpen: false, interval: refresh.interval, f: { t, fmt, timezone: 'America/Bogota', language: 'es' }, adjustments: [] });
  return <p data-testid="rows">{detail.sales.rows.map((r) => r.id).join(',') || detail.sales.state}</p>;
}
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(1);
  });
};

describe('detalle: actualización automática', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    focused = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    vi.mocked(api.cashDaySales).mockReset();
    vi.mocked(api.expensesPage).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const renderProbe = (target: CashDetailTarget | null, live = true) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <Probe target={target} live={live} />
      </QueryClientProvider>,
    );
  };

  it('cerrado: no pide nada', async () => {
    renderProbe(null);
    await tick(CASH_LIVE_INTERVAL_MS * 3);
    expect(api.cashDaySales).not.toHaveBeenCalled();
    expect(api.expensesPage).not.toHaveBeenCalled();
  });

  it('abierto hoy: una venta nueva aparece sola y conserva la selección del empleado', async () => {
    vi.mocked(api.cashDaySales).mockResolvedValueOnce(salesPage(['s1'])).mockResolvedValueOnce(salesPage(['s2', 's1']));
    renderProbe({ scope: 'employee', employeeId: 'ana', name: 'Ana' });
    await tick(0);
    expect(screen.getByTestId('rows').textContent).toBe('s1');
    await tick(CASH_LIVE_INTERVAL_MS);
    expect(screen.getByTestId('rows').textContent).toBe('s2,s1');
    expect(vi.mocked(api.cashDaySales).mock.calls.every(([q]) => q.scope === 'employee' && q.employeeId === 'ana' && q.day === '2026-10-19')).toBe(true);
  });

  it('día pasado: se pide una vez y no se repite', async () => {
    vi.mocked(api.cashDaySales).mockResolvedValue(salesPage(['s1']));
    renderProbe({ scope: 'unattributed' }, false);
    await tick(0);
    await tick(CASH_LIVE_INTERVAL_MS * 5);
    expect(api.cashDaySales).toHaveBeenCalledTimes(1);
  });

  it('pestaña oculta: pausa; error temporal: conserva los datos', async () => {
    vi.mocked(api.cashDaySales).mockResolvedValueOnce(salesPage(['s1'])).mockRejectedValueOnce(new Error('offline_error'));
    renderProbe({ scope: 'employee', employeeId: 'ana', name: 'Ana' });
    await tick(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await tick(CASH_LIVE_INTERVAL_MS * 3);
    expect(api.cashDaySales).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await tick(CASH_LIVE_INTERVAL_MS);
    expect(screen.getByTestId('rows').textContent).toBe('s1'); // falló la actualización: se conserva lo último válido
  });
});

