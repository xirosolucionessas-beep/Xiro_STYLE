/**
 * Ruta /sales-today SOLO WEB (fallback nativo: sales-today.tsx redirige al inicio). Ventas del día: cada transacción
 * con hora, cliente, líneas, empleado, forma de pago, total y acumulado — a donde llevan las tarjetas "Ventas hoy" y
 * "Servicios hoy" del tablero de Inicio. Presentación en src/web/screens/SalesToday.tsx.
 */
import type { SalePaymentMethod } from '@xiro/shared';
import { formatMoney, type Currency } from '@xiro/shared';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { dayRange, formatClock, localTime, todayIn } from '@/lib/agenda';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useInvalidateSales, useSales } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { SalesTodayView, type SaleRowView } from '@/web/screens/SalesToday';
import type { KpiView } from '@/web/ui/Page';
import { useWebText } from '@/web/services/useWebText';
import { VoidSaleModal } from '@/web/ui/VoidSaleModal';

export default function SalesTodayWeb() {
  const { t, language } = useWebText();
  const { user, business } = useAuthed();
  const isOwner = user.role === 'owner';
  const currency = business.currency as Currency;
  const money = (amount: number) => formatMoney(amount, currency);

  const todayKey = todayIn(business.timezone);
  const range = useMemo(() => dayRange(todayKey, business.timezone, 1), [todayKey, business.timezone]);
  const sales = useSales(range);
  const invalidateSales = useInvalidateSales();

  // Llegar desde la tarjeta "Servicios hoy" del tablero (?kind=service) abre la lista ya filtrada a ventas con algún
  // servicio, en vez de obligar a filtrarla a mano.
  const params = useLocalSearchParams<{ kind?: string }>();
  const initialKind = params.kind === 'service' || params.kind === 'product' ? params.kind : null;
  const [paymentFilter, setPaymentFilter] = useState<SalePaymentMethod | null>(null);
  const [statusFilter, setStatusFilter] = useState<'completed' | 'voided' | null>(null);
  const [kindFilter, setKindFilter] = useState<'service' | 'product' | null>(initialKind);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);

  const payLabel = (method: SalePaymentMethod) => t(`sale_pay_${method}`);

  // Orden cronológico (la venta más antigua primero): así el "acumulado" se lee de arriba hacia abajo, como una cinta de caja.
  const chronological = useMemo(() => [...(sales.data ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), [sales.data]);

  // Sin useMemo: como `money`/`payLabel` cambian en cada render (dependen de `t`/`currency`), memoizar no ahorraría nada,
  // y el volumen es el de un día de ventas — de sobra para recalcular sin más.
  const filteredSales = chronological
    .filter((sale) => statusFilter === null || sale.status === statusFilter)
    .filter((sale) => paymentFilter === null || sale.payments.some((p) => p.method === paymentFilter))
    .filter((sale) => kindFilter === null || sale.items.some((item) => item.kind === kindFilter));
  // reduce (no un `let` mutado fuera del map): el acumulado nace y muere dentro del propio cálculo, sin estado externo.
  const rows: SaleRowView[] = filteredSales.reduce<{ running: number; rows: SaleRowView[] }>(
    (acc, sale) => {
      const running = sale.status === 'completed' ? acc.running + sale.total : acc.running;
      const employees = [...new Set(sale.items.map((item) => item.employeeName).filter((name): name is string => Boolean(name)))];
      const methods = [...new Set(sale.payments.map((p) => p.method))];
      acc.rows.push({
        id: sale.id,
        time: formatClock(localTime(sale.createdAt, business.timezone), language),
        client: sale.clientName,
        items: sale.items.map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name)).join(', '),
        employee: employees.length > 0 ? employees.join(', ') : null,
        payment: methods.map(payLabel).join(', '),
        paymentMethods: methods,
        total: money(sale.total),
        running: money(running),
        status: sale.status,
        voidReason: sale.voidReason,
        canVoid: isOwner && sale.status === 'completed',
      });
      return { running, rows: acc.rows };
    },
    { running: 0, rows: [] },
  ).rows;

  const completed = chronological.filter((sale) => sale.status === 'completed');
  const total = completed.reduce((acc, sale) => acc + sale.total, 0);
  const kpis: KpiView[] = [
    { id: 'total', icon: 'coins', label: t('sale_kpi_total'), value: sales.data ? money(total) : '—', loading: sales.isLoading },
    { id: 'count', icon: 'receipt', label: t('sale_kpi_count'), value: sales.data ? String(completed.length) : '—', loading: sales.isLoading },
    { id: 'average', icon: 'bar-chart', label: t('sale_kpi_average'), value: completed.length > 0 ? money(Math.round(total / completed.length)) : '—', loading: sales.isLoading },
  ];

  async function confirmVoid(reason: string) {
    if (!voidTarget) return { ok: false };
    try {
      await api.voidSale(voidTarget, reason);
      await invalidateSales(true);
      setVoidTarget(null);
      return { ok: true };
    } catch (error) {
      return { ok: false, general: apiErrors(error, t).general ?? t('unknown_error') };
    }
  }

  return (
    <Screen header={<Header title={t('nav_sales_today')} />}>
      <SalesTodayView
        t={t}
        kpis={kpis}
        rows={rows}
        paymentFilter={paymentFilter}
        onPaymentFilter={setPaymentFilter}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        kindFilter={kindFilter}
        onKindFilter={setKindFilter}
        state={sales.isLoading ? 'loading' : sales.isError ? 'error' : 'ready'}
        errorMessage={sales.isError ? apiErrors(sales.error, t).general : undefined}
        onRetry={() => void sales.refetch()}
        onVoid={setVoidTarget}
        hasAnySale={chronological.length > 0}
      />
      <VoidSaleModal open={voidTarget !== null} onClose={() => setVoidTarget(null)} t={t} onSubmit={confirmVoid} />
    </Screen>
  );
}
