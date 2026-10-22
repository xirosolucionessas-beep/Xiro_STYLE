import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { CashCloseView, type CashCloseViewProps } from '../src/web/screens/CashClose';
import { formatMoney } from '@xiro/shared';
import { breakdownView } from '../src/lib/cashBreakdown';
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

describe('cierre de caja: producción por empleado y estado de actualización', () => {
  const fmt = (n: number) => formatMoney(n, 'COP');
  const breakdown = breakdownView(t, fmt, {
    employees: [
      { employeeId: 'ana', employeeName: 'Ana', serviceUnits: 4, services: [{ name: 'Corte', units: 4, gross: 80000, discount: 4201, net: 75799 }], gross: 80000, discount: 4201, net: 75799 },
      { employeeId: 'luis', employeeName: 'Luis', serviceUnits: 1, services: [{ name: 'Tinte', units: 1, gross: 30000, discount: 2100, net: 27900 }], gross: 30000, discount: 2100, net: 27900 },
    ],
    unattributed: { serviceUnits: 0, services: [], productUnits: 2, products: [{ name: 'Champú', units: 2, gross: 10000, discount: 700, net: 9300 }], gross: 10000, discount: 700, net: 9300 },
    totals: { gross: 120000, discount: 7001, net: 112999, tip: 5000, total: 117999 },
  });

  it('cada empleado con bruto, descuentos y neto; productos y propinas sin atribución inventada', async () => {
    const { container } = render(<CashCloseView {...baseProps({ breakdown })} />);
    const ana = screen.getByRole('region', { name: 'Ana' });
    expect(ana.textContent).toContain('4 servicios');
    expect(ana.textContent).toContain('Bruto');
    expect(ana.textContent).toContain(fmt(80000));
    expect(ana.textContent).toContain(`−${fmt(4201)}`);
    expect(ana.textContent).toContain(fmt(75799));
    expect(ana.textContent).toContain('Corte ×4');
    const loose = screen.getByRole('region', { name: 'Sin atribución' });
    expect(loose.textContent).toContain('Champú ×2');
    expect(loose.textContent).toContain('no registra quién vendió');
    expect(screen.getByText(/Las propinas no se atribuyen/)).toBeTruthy();
    expect(container.textContent).toContain(`Neto ${fmt(112999)} + propinas ${fmt(5000)} = ventas del día ${fmt(117999)}`);
    expect(screen.queryByText(/ganancia neta|comisión de/i)).toBeNull();
    await noViolations(container);
  });

  it('estado de actualización visible y reintento cuando falla con datos', async () => {
    const onRetry = vi.fn();
    render(<CashCloseView {...baseProps({ breakdown, onRetry, live: { text: 'No se pudo actualizar. Se muestran los datos de las 10:32 a. m.', problem: true } })} />);
    expect(screen.getByRole('status').textContent).toContain('Se muestran los datos de las 10:32');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalled();
    // Los datos válidos siguen a la vista.
    expect(screen.getByRole('region', { name: 'Ana' })).toBeTruthy();
  });

  it('el cierre firmado sigue mostrando quién cerró y cuándo', () => {
    render(
      <CashCloseView
        {...baseProps({
          canAct: false,
          closed: { countedAmount: '$ 70.000', expectedAmount: '$ 70.000', difference: '+$ 0', surplus: true, note: '', closedByName: 'Dueña', closedByLine: 'Cerrado por Dueña el 19 oct a las 6:40 p. m.', status: 'completed', voidReason: '' },
        })}
      />,
    );
    expect(screen.getByText('Cerrado por Dueña el 19 oct a las 6:40 p. m.')).toBeTruthy();
  });
});

describe('cierre de caja: botones Ver más', () => {
  it('cada empleado, lo sin atribuir y los gastos tienen su Ver más accesible por nombre', async () => {
    const onSeeMore = vi.fn();
    const onSeeMoreExpenses = vi.fn();
    const breakdown = breakdownView(t, (n: number) => formatMoney(n, 'COP'), {
      employees: [{ employeeId: 'ana', employeeName: 'Ana', serviceUnits: 1, services: [], gross: 20000, discount: 0, net: 20000 }],
      unattributed: { serviceUnits: 0, services: [], productUnits: 1, products: [{ name: 'Gel', units: 1, gross: 5000, discount: 0, net: 5000 }], gross: 5000, discount: 0, net: 5000 },
      totals: { gross: 25000, discount: 0, net: 25000, tip: 0, total: 25000 },
    });
    const { container } = render(<CashCloseView {...baseProps({ breakdown, onSeeMore, onSeeMoreExpenses })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver más ventas de Ana' }));
    expect(onSeeMore).toHaveBeenLastCalledWith({ scope: 'employee', employeeId: 'ana', name: 'Ana' });
    await userEvent.click(screen.getByRole('button', { name: 'Ver más ventas sin empleado atribuido' }));
    expect(onSeeMore).toHaveBeenLastCalledWith({ scope: 'unattributed' });
    // Teclado: el botón de gastos se activa con Enter.
    screen.getByRole('button', { name: 'Ver más gastos del día' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onSeeMoreExpenses).toHaveBeenCalled();
    await noViolations(container);
  });
});

describe('cierre de caja: gráficas animadas', () => {
  it('barras por hora en cascada con la hora pico marcada, y barras de proporción en formas de pago y ranking', () => {
    const bars = Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: '', aria: `${hour}:00`, height: hour === 9 ? 1 : hour === 10 ? 0.36 : 0, value: hour === 9 || hour === 10 ? 'x' : undefined, empty: hour !== 9 && hour !== 10 }));
    const { container } = render(<CashCloseView {...baseProps({ bars, paymentRows: [{ id: 'cash', name: 'Efectivo', value: '$ 567.655', sub: '3 veces', share: 1 }], topServices: [{ id: 'a', name: 'perfumes', value: '$ 300.000', sub: '2 veces', share: 1 }, { id: 'b', name: 'peluqueada', value: '$ 150.000', sub: '1 vez', share: 0.5 }] })} />);
    const chart = container.querySelector('.xw-cash-bars')!;
    const items = chart.querySelectorAll('li');
    expect(items).toHaveLength(24);
    expect((items[9] as HTMLElement).style.getPropertyValue('--i')).toBe('9');
    expect(items[9]!.classList.contains('is-peak')).toBe(true);
    expect(items[10]!.classList.contains('is-peak')).toBe(false);
    const fills = container.querySelectorAll('.xw-cash-share-fill');
    expect(Array.from(fills).map((el) => (el as HTMLElement).style.width)).toEqual(['100%', '100%', '50%']);
    // Las barras son decorativas: el valor sigue en texto para el lector de pantalla.
    expect(container.querySelector('.xw-cash-share')!.getAttribute('aria-hidden')).toBe('true');
  });
});
