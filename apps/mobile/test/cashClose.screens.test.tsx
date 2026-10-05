import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { CashCloseView, type CashCloseViewProps } from '../src/web/screens/CashClose';
import { tw } from '../src/web/shell/strings';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

function baseProps(over: Partial<CashCloseViewProps> = {}): CashCloseViewProps {
  return {
    t,
    currency: 'COP',
    dayLabel: 'miércoles, 30 de septiembre de 2026',
    isToday: true,
    todayHref: '/cash-close',
    navigate: vi.fn(),
    state: 'ready',
    onRetry: vi.fn(),
    kpis: [{ id: 'sales', icon: 'coins', label: 'Ventas del día', value: '$ 80.000' }],
    bars: Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: '', aria: `${hour}:00 — $ 0`, height: 0, empty: true })),
    paymentRows: [{ id: 'cash', name: 'Efectivo', value: '$ 30.000', sub: '1 vez' }],
    topServices: [{ id: 'svc:Corte', name: 'Corte', value: '$ 30.000', sub: '1 vez' }],
    topProducts: [],
    employeeRows: [],
    expenseRows: [],
    clientsServed: 1,
    newClients: 0,
    appointments: { completed: 0, cancelled: 0, noShow: 0 },
    closed: null,
    isOwner: true,
    canAct: true,
    expenseOpen: false,
    onToggleExpense: vi.fn(),
    expenseAmount: 0,
    onExpenseAmount: vi.fn(),
    expenseDescription: '',
    onExpenseDescription: vi.fn(),
    expenseMethod: 'cash',
    onExpenseMethod: vi.fn(),
    onAddExpense: vi.fn(),
    expenseBusy: false,
    hasOpening: true,
    countedAmount: 0,
    onCountedAmount: vi.fn(),
    closeNote: '',
    onCloseNote: vi.fn(),
    onSubmitClose: vi.fn(),
    closeBusy: false,
    expectedCashPreview: 130_000,
    onOpenVoid: vi.fn(),
    onWhatsapp: vi.fn(),
    onPrint: vi.fn(),
    history: [],
    ...over,
  };
}

describe('CashCloseView', () => {
  it('el día abierto muestra el resumen en vivo y el formulario para cerrar, sin violaciones de accesibilidad', async () => {
    const props = baseProps();
    const { container } = render(<CashCloseView {...props} />);
    expect(screen.getByText('$ 80.000')).toBeTruthy();
    expect(screen.getByText(/Efectivo esperado ahora mismo/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar caja' }));
    expect(props.onSubmitClose).toHaveBeenCalled();
    await noViolations(container);
  });

  it('sin base de caja abierta no ofrece el campo de contar, solo el aviso', () => {
    render(<CashCloseView {...baseProps({ hasOpening: false })} />);
    expect(screen.getByText('Abre la caja con la base del día para poder cerrarla.')).toBeTruthy();
    expect(screen.queryByLabelText('Efectivo contado físicamente')).toBeNull();
  });

  it('un día ya cerrado muestra el resumen guardado (sobrante en verde) y el botón de anular, sin el formulario de cerrar', () => {
    const props = baseProps({
      canAct: false,
      closed: { countedAmount: '$ 72.000', expectedAmount: '$ 70.000', difference: '+$ 2.000', surplus: true, note: 'Todo cuadrado', closedByName: 'Dueña', status: 'completed', voidReason: '' },
    });
    render(<CashCloseView {...props} />);
    expect(screen.getByText('Completado')).toBeTruthy();
    expect(screen.getByText('Sobrante')).toBeTruthy();
    expect(screen.getByText('+$ 2.000')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cerrar caja' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anular cierre' })).toBeTruthy();
  });

  it('un empleado (no dueño) no ve el botón de anular aunque el día esté cerrado', () => {
    const props = baseProps({
      isOwner: false,
      canAct: false,
      closed: { countedAmount: '$ 10.000', expectedAmount: '$ 10.000', difference: '$ 0', surplus: true, note: '', closedByName: 'Dueña', status: 'completed', voidReason: '' },
    });
    render(<CashCloseView {...props} />);
    expect(screen.queryByRole('button', { name: 'Anular cierre' })).toBeNull();
  });

  it('un cierre anulado muestra el motivo y no ofrece anularlo otra vez', () => {
    const props = baseProps({
      canAct: false,
      closed: { countedAmount: '$ 10.000', expectedAmount: '$ 15.000', difference: '-$ 5.000', surplus: false, note: '', closedByName: 'Dueña', status: 'voided', voidReason: 'Conteo equivocado' },
    });
    render(<CashCloseView {...props} />);
    expect(screen.getByText('Anulado')).toBeTruthy();
    expect(screen.getByText('Faltante')).toBeTruthy();
    expect(screen.getByText('Motivo: Conteo equivocado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Anular cierre' })).toBeNull();
  });

  it('un día pasado sin cerrar no muestra el formulario de cerrar ni el de gastos', () => {
    render(<CashCloseView {...baseProps({ isToday: false, canAct: false })} />);
    expect(screen.queryByRole('button', { name: 'Cerrar caja' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrar gasto' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ir a hoy' })).toBeTruthy();
  });

  it('el historial enlaza a cada día anterior', async () => {
    const props = baseProps({ history: [{ id: 'c1', dayLabel: '29 sept', total: '$ 50.000', difference: '$ 0', status: 'completed', href: '/cash-close?day=2026-09-29' }] });
    render(<CashCloseView {...props} />);
    await userEvent.click(screen.getByRole('link', { name: '29 sept' }));
    expect(props.navigate).toHaveBeenCalledWith('/cash-close?day=2026-09-29');
  });
});
