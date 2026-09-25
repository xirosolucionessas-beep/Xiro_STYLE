/**
 * Ruta /reports SOLO WEB (fallback nativo: reports.tsx redirige al inicio). Ventas, servicios, clientes e inventario del
 * periodo elegido, calculados con los registros de servicio que la app ya consulta (sin cambios en la API).
 * Presentación en src/web/screens/Reports.tsx.
 */
import { formatMoney, type Currency } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { variation, type Trend } from '@/lib/dashboard';
import { lowStock } from '@/lib/homeMetrics';
import { isTruncated, inventoryValue, newClientsInPeriod, periodTotals, RECORD_LIMIT, salesByDay, topClients, topServices } from '@/lib/sections';
import { useClients, useItems, useServiceRecords } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { ReportsView, type BarView } from '@/web/screens/Reports';
import { useNow } from '@/web/services/useNow';
import { useWebText } from '@/web/services/useWebText';
import type { KpiView } from '@/web/ui/Page';

type T = (key: string, params?: Record<string, string | number>) => string;

/** Variación frente al periodo anterior; sin base de comparación no se inventa un porcentaje. */
function trendView(trend: Trend, t: T): KpiView['trend'] {
  if (trend.direction === 'none') return undefined;
  if (trend.direction === 'flat') return { direction: 'flat', text: t('sec_trend_flat') };
  if (trend.percent === null) return { direction: 'up', text: t('sec_trend_new') };
  return { direction: trend.direction, text: t(trend.direction === 'up' ? 'sec_trend_up' : 'sec_trend_down', { n: Math.abs(trend.percent) }) };
}

export default function ReportsWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { business } = useAuthed();
  const nowMs = useNow();
  const [period, setPeriod] = useState<'7' | '30'>('7');
  const days = Number(period);
  const currency = business.currency as Currency;
  const money = (amount: number) => formatMoney(amount, currency);

  const records = useServiceRecords(undefined, true);
  const clients = useClients('');
  const items = useItems();

  const report = useMemo(() => {
    const now = new Date(nowMs);
    const list = records.data ?? [];
    const buckets = salesByDay(list, business.timezone, days, now);
    const peak = Math.max(0, ...buckets.map((bucket) => bucket.total));
    const dayFormat = new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    const weekday = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' });
    const bars: BarView[] = buckets.map((bucket, index) => {
      const at = new Date(`${bucket.key}T12:00:00Z`);
      const showLabel = days <= 7 || index % 5 === days % 5 || index === buckets.length - 1;
      return {
        key: bucket.key,
        label: showLabel ? (days <= 7 ? weekday.format(at) : String(Number(bucket.key.slice(8)))) : '',
        aria: t('sec_bar_aria', { day: dayFormat.format(at), amount: money(bucket.total) }),
        height: peak > 0 ? bucket.total / peak : 0,
        value: days <= 7 && bucket.total > 0 ? money(bucket.total) : undefined,
        empty: bucket.total === 0,
      };
    });
    return {
      totals: periodTotals(list, business.timezone, days, now),
      bars,
      services: topServices(list, business.timezone, days, now),
      clients: topClients(list, business.timezone, days, now),
      newClients: clients.data ? newClientsInPeriod(clients.data, business.timezone, days, now) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `money` y `t` solo dependen de moneda e idioma, ya listados.
  }, [records.data, clients.data, business.timezone, days, nowMs, language, currency, t]);

  const truncated = records.data ? isTruncated(records.data) : false;
  const { current, previous } = report.totals;
  const compare = !truncated;
  const kpis: KpiView[] = [
    { id: 'sales', icon: 'coins', label: t('sec_rep_sales'), value: records.data ? money(current.total) : '—', loading: records.isLoading, trend: compare && records.data ? trendView(variation(current.total, previous.total), t) : undefined },
    { id: 'services', icon: 'scissors', label: t('sec_rep_services'), value: records.data ? String(current.count) : '—', loading: records.isLoading, trend: compare && records.data ? trendView(variation(current.count, previous.count), t) : undefined },
    { id: 'avg', icon: 'receipt', label: t('sec_rep_avg'), value: current.average !== null ? money(current.average) : '—', loading: records.isLoading },
    { id: 'clients', icon: 'users', label: t('sec_rep_new_clients'), value: report.newClients !== null ? String(report.newClients) : '—', loading: clients.isLoading },
  ];

  const times = (n: number) => (n === 1 ? t('sec_rep_time_one') : t('sec_rep_times', { n }));
  const visits = (n: number) => (n === 1 ? t('sec_rep_visit_one') : t('sec_rep_visits', { n }));
  const stockInfo = items.data ? lowStock(items.data) : null;
  const value = items.data ? inventoryValue(items.data) : null;

  return (
    <Screen header={<Header root title={t('nav_reports')} subtitle={t('sec_reports_sub')} />}>
      <ReportsView
        t={t}
        period={period}
        onPeriod={setPeriod}
        kpis={kpis}
        loading={records.isLoading}
        empty={report.totals.current.count === 0}
        bars={report.bars}
        topServices={report.services.map((row) => ({ id: row.label, name: row.label, value: money(row.total), sub: times(row.count) }))}
        topClients={report.clients.map((row) => ({ id: row.label, name: row.label, value: money(row.total), sub: visits(row.count) }))}
        stock={stockInfo ? { value: value === null ? '—' : money(value), low: stockInfo.count, href: `/inventory?status=${stockInfo.outOfStock > 0 ? 'out_of_stock' : 'reorder'}` } : null}
        note={truncated ? t('sec_rep_truncated', { n: RECORD_LIMIT }) : undefined}
        navigate={(href) => router.push(href as never)}
      />
    </Screen>
  );
}
