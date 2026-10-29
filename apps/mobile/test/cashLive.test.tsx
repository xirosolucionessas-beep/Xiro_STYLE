import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { CashDaySummary } from '@xiro/shared';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { CASH_LIVE_INTERVAL_MS } from '../src/lib/cashBreakdown';
import { useCashCloseSummary } from '../src/lib/queries';
import { useLiveRefresh } from '../src/lib/useLiveRefresh.web';

/**
 * Actualización automática del cierre de caja (web; la versión nativa usa la misma consulta con AppState y el foco de la
 * pantalla): el resumen se vuelve a pedir al backend cada 30 s solo para HOY con la pantalla visible, conserva los últimos
 * datos válidos ante un error y no consulta días pasados ni con la pestaña oculta o sin conexión.
 */
vi.mock('../src/lib/api', () => ({ api: { cashCloseSummary: vi.fn() }, fetchAllPages: vi.fn() }));
let focused = true;
vi.mock('expo-router', () => ({ useIsFocused: () => focused }));

const summaryOf = (total: number, employees: Array<[string, number]>): CashDaySummary =>
  ({
    day: '2026-10-19',
    totalSales: total,
    employeeBreakdown: {
      employees: employees.map(([name, net]) => ({ employeeId: name, employeeName: name, serviceUnits: 1, services: [], gross: net, discount: 0, net })),
      unattributed: { serviceUnits: 0, services: [], productUnits: 0, products: [], gross: 0, discount: 0, net: 0 },
      totals: { gross: total, discount: 0, net: total, tip: 0, total },
    },
  }) as unknown as CashDaySummary;

function Probe({ day, live }: { day: string; live: boolean }) {
  const resume = useRef<() => void>(() => undefined);
  const refresh = useLiveRefresh(live, () => resume.current());
  const query = useCashCloseSummary(day, true, refresh.interval);
  useEffect(() => {
    resume.current = () => void query.refetch();
  });
  const data = query.data;
  return (
    <div>
      <p data-testid="total">{data ? data.totalSales : 'cargando'}</p>
      <p data-testid="employees">{data?.employeeBreakdown?.employees.map((e) => `${e.employeeName}:${e.net}`).join(',')}</p>
      <p data-testid="error">{query.isError ? 'error' : 'ok'}</p>
      <p data-testid="active">{refresh.active ? 'activo' : 'pausa'}</p>
    </div>
  );
}

const mocked = () => vi.mocked(api.cashCloseSummary);
function renderProbe(day = '2026-10-19', live = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
  return render(
    <QueryClientProvider client={client}>
      <Probe day={day} live={live} />
    </QueryClientProvider>,
  );
}
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    // React Query avisa a la pantalla en el siguiente ciclo del temporizador (notifyManager).
    await vi.advanceTimersByTimeAsync(1);
  });
};
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

describe('cierre de caja: actualización automática', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    focused = true;
    setVisibility('visible');
    mocked().mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('una venta nueva y una anulación aparecen sin recargar; totales y empleados cambian juntos', async () => {
    mocked()
      .mockResolvedValueOnce(summaryOf(20_000, [['Ana', 20_000]]))
      .mockResolvedValueOnce(summaryOf(50_000, [['Ana', 20_000], ['Luis', 30_000]]))
      .mockResolvedValueOnce(summaryOf(30_000, [['Luis', 30_000]]));
    renderProbe();
    await tick(0);
    expect(screen.getByTestId('total').textContent).toBe('20000');
    expect(screen.getByTestId('employees').textContent).toBe('Ana:20000');

    await tick(CASH_LIVE_INTERVAL_MS);
    expect(screen.getByTestId('total').textContent).toBe('50000');
    expect(screen.getByTestId('employees').textContent).toBe('Ana:20000,Luis:30000');

    // Venta de Ana anulada en el backend: deja de contar en el total y en su desglose a la vez.
    await tick(CASH_LIVE_INTERVAL_MS);
    expect(screen.getByTestId('total').textContent).toBe('30000');
    expect(screen.getByTestId('employees').textContent).toBe('Luis:30000');
    expect(mocked()).toHaveBeenCalledTimes(3);
  });

  it('pestaña oculta: no consulta; al volver pide una vez y retoma el intervalo', async () => {
    mocked().mockResolvedValue(summaryOf(20_000, [['Ana', 20_000]]));
    renderProbe();
    await tick(0);
    expect(mocked()).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    expect(screen.getByTestId('active').textContent).toBe('pausa');
    await tick(CASH_LIVE_INTERVAL_MS * 5);
    expect(mocked()).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await tick(0);
    expect(mocked()).toHaveBeenCalledTimes(2); // al volver, una sola vez
    await tick(CASH_LIVE_INTERVAL_MS);
    expect(mocked()).toHaveBeenCalledTimes(3); // y luego cada 30 s
  });

  it('otra pantalla enfocada (la de caja sigue montada en la pila): no consulta; al volver pide una vez', async () => {
    mocked().mockResolvedValue(summaryOf(20_000, []));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <Probe day="2026-10-19" live />
      </QueryClientProvider>
    );
    const view = render(tree());
    await tick(0);
    focused = false;
    view.rerender(tree());
    expect(screen.getByTestId('active').textContent).toBe('pausa');
    await tick(CASH_LIVE_INTERVAL_MS * 3);
    expect(mocked()).toHaveBeenCalledTimes(1);
    focused = true;
    view.rerender(tree());
    await tick(0);
    expect(mocked()).toHaveBeenCalledTimes(2);
  });

  it('sin conexión se pausa', async () => {
    mocked().mockResolvedValue(summaryOf(20_000, []));
    renderProbe();
    await tick(0);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await tick(CASH_LIVE_INTERVAL_MS * 3);
    expect(mocked()).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await tick(0);
    expect(mocked()).toHaveBeenCalledTimes(2);
  });

  it('día pasado: se pide una vez y no se vuelve a consultar solo', async () => {
    mocked().mockResolvedValue(summaryOf(80_000, [['Ana', 80_000]]));
    renderProbe('2026-10-10', false);
    await tick(0);
    await tick(CASH_LIVE_INTERVAL_MS * 10);
    expect(mocked()).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('active').textContent).toBe('pausa');
  });

  it('error de red temporal: conserva el último resumen válido y se recupera en la siguiente vuelta', async () => {
    mocked()
      .mockResolvedValueOnce(summaryOf(20_000, [['Ana', 20_000]]))
      .mockRejectedValueOnce(new Error('offline_error'))
      .mockResolvedValueOnce(summaryOf(50_000, [['Ana', 50_000]]));
    renderProbe();
    await tick(0);
    await tick(CASH_LIVE_INTERVAL_MS);
    expect(screen.getByTestId('error').textContent).toBe('error');
    expect(screen.getByTestId('total').textContent).toBe('20000'); // no se borra ni se inventa
    await tick(CASH_LIVE_INTERVAL_MS);
    expect(screen.getByTestId('error').textContent).toBe('ok');
    expect(screen.getByTestId('total').textContent).toBe('50000');
  });
});
