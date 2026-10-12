/**
 * Ruta /reports SOLO WEB (fallback nativo: reports.tsx redirige al inicio). Ventas, servicios, clientes e inventario
 * del periodo elegido (hoy/semana/mes/año/rango personalizado), calculados con las ventas reales del negocio
 * (`GET /api/sales?from&to`, acotado por fecha en el propio servidor — ver sections.ts para el porqué del cambio
 * frente a los registros de servicio que usaba antes). Presentación en src/web/screens/Reports.tsx.
 */
import { addDays, formatMoney, type Currency } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { variation, type Trend } from '@/lib/dashboard';
import { useCashOpenings, useClientsSummary, useItemsSummary, useSales } from '@/lib/queries';
import {
  cashBalance as cashBalanceOf,
  employeePerformance,
  isTruncated,
  openingBaseTotal,
  paymentMethodBreakdown,
  reportBuckets,
  resolveReportRange,
  RECORD_LIMIT,
  salesSummary,
  topSaleClients,
  topSaleItems,
  type ReportPeriod,
} from '@/lib/sections';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { businessAddressLine, toDataUrl } from '@/web/services/invoicePdf';
import { downloadReportsExcel } from '@/web/services/reportsExcel';
import { downloadReportsPdf } from '@/web/services/reportsPdf';
import { ReportsView, type BarView, type CashBalanceView, type EmployeeView, type GrowthView, type PaymentMethodView } from '@/web/screens/Reports';
import { resolveMedia } from '@/web/media';
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

const PAYMENT_METHOD_LABEL_KEY: Record<string, string> = { cash: 'sale_pay_cash', card: 'sale_pay_card', nequi: 'sale_pay_nequi', bank_transfer: 'sale_pay_bank_transfer', other: 'sale_pay_other' };

export default function ReportsWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { business } = useAuthed();
  const nowMs = useNow();
  const [period, setPeriod] = useState<ReportPeriod>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const currency = business.currency as Currency;
  const money = (amount: number) => formatMoney(amount, currency);

  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const range = useMemo(() => {
    try {
      return resolveReportRange(period, business.timezone, now, period === 'custom' ? { from: customFrom, to: customTo } : undefined);
    } catch {
      return null;
    }
  }, [period, business.timezone, now, customFrom, customTo]);
  const customError = period === 'custom' && !range ? t('sec_period_invalid_range') : undefined;

  const salesCurrent = useSales(range?.current ?? null, Boolean(range));
  const salesPrevious = useSales(range?.previous ?? null, Boolean(range));
  // `/cash/openings` toma días locales ("YYYY-MM-DD"), no instantes ISO como `/sales` — ver `api.cashOpenings`.
  const cashOpeningsQuery = useCashOpenings(range ? { from: range.current.startDate, to: addDays(range.current.startDate, range.current.days - 1) } : null, Boolean(range));
  // Clientes nuevos del periodo EXACTO [desde, hasta) e inventario: calculados en el servidor (sin descargar listas).
  const clients = useClientsSummary(range ? { from: range.current.from, to: range.current.to } : undefined, Boolean(range));
  const items = useItemsSummary();

  const report = useMemo(() => {
    const currentSales = salesCurrent.data ?? [];
    const previousSales = salesPrevious.data ?? [];
    const dayFormat = new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const weekday = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' });
    const monthFormat = new Intl.DateTimeFormat(language, { month: 'short', year: 'numeric', timeZone: 'UTC' });

    const buckets = range ? reportBuckets(currentSales, business.timezone, range.current) : [];
    const peak = Math.max(0, ...buckets.map((bucket) => bucket.total));
    const isMonthly = (range?.current.days ?? 0) > 35;
    const bars: BarView[] = buckets.map((bucket, index) => {
      const isMonthKey = /^\d{4}-\d{2}$/.test(bucket.key);
      const at = new Date(isMonthKey ? `${bucket.key}-01T12:00:00Z` : `${bucket.key}T12:00:00Z`);
      const showLabel = isMonthly || buckets.length <= 7 || index % 5 === buckets.length % 5 || index === buckets.length - 1;
      const dateLabel = isMonthKey ? monthFormat.format(at) : dayFormat.format(at);
      return {
        key: bucket.key,
        label: showLabel ? (isMonthly ? monthFormat.format(at) : buckets.length <= 7 ? weekday.format(at) : String(Number(bucket.key.slice(8)))) : '',
        aria: t('sec_bar_aria', { day: dateLabel, amount: money(bucket.total) }),
        height: peak > 0 ? bucket.total / peak : 0,
        value: buckets.length <= 7 && bucket.total > 0 ? money(bucket.total) : undefined,
        empty: bucket.total === 0,
        tooltip: { dateLabel, amountLabel: `${t('sec_rep_sales')}: ${money(bucket.total)}`, countLabel: `${t('sec_rep_services')}: ${bucket.count}` },
      };
    });

    return {
      current: salesSummary(currentSales),
      previous: salesSummary(previousSales),
      bars,
      buckets,
      services: topSaleItems(currentSales, 'service'),
      products: topSaleItems(currentSales, 'product'),
      topClients: topSaleClients(currentSales),
      paymentMethods: paymentMethodBreakdown(currentSales),
      employees: employeePerformance(currentSales),
      newClients: range ? (clients.data?.newInRange ?? null) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `money`/`t` solo dependen de moneda e idioma, ya listados.
  }, [salesCurrent.data, salesPrevious.data, clients.data, range, business.timezone, now, language, currency]);

  const dataLoading = salesCurrent.isLoading || salesPrevious.isLoading;
  const truncated = salesCurrent.data ? isTruncated(salesCurrent.data) : false;
  const growthTrend = variation(report.current.total, report.previous.total);
  const growth: GrowthView | null = range
    ? {
        direction: growthTrend.direction,
        percentLabel: growthTrend.percent === null ? null : `${growthTrend.percent >= 0 ? '+' : ''}${growthTrend.percent}%`,
        currentLabel: money(report.current.total),
        previousLabel: money(report.previous.total),
      }
    : null;

  // `openingTotal`: suma de las bases de caja registradas en el periodo; `null` mientras no haya datos reales que sumar.
  const openingTotal = range && cashOpeningsQuery.data ? openingBaseTotal(cashOpeningsQuery.data) : null;

  // Rango inválido (sección 6): ningún KPI inventa un "0" con tendencia — se muestran como sin dato, igual que cuando falta cualquier otro cálculo.
  const kpis: KpiView[] = [
    { id: 'sales', icon: 'coins', label: t('sec_rep_sales'), value: range ? money(report.current.total) : '—', numeric: range ? report.current.total : undefined, format: money, loading: dataLoading, trend: range && !truncated ? trendView(growthTrend, t) : undefined },
    { id: 'services', icon: 'scissors', label: t('sec_rep_services'), value: range ? String(report.current.count) : '—', numeric: range ? report.current.count : undefined, format: (n) => String(Math.round(n)), loading: dataLoading, trend: range && !truncated ? trendView(variation(report.current.count, report.previous.count), t) : undefined },
    { id: 'avg', icon: 'receipt', label: t('sec_rep_avg'), value: range && report.current.average !== null ? money(report.current.average) : '—', loading: dataLoading },
    { id: 'clients', icon: 'users', label: t('sec_rep_new_clients'), value: range && report.newClients !== null ? String(report.newClients) : '—', loading: clients.isLoading },
    { id: 'opening', icon: 'wallet', label: t('sec_rep_opening_base'), value: openingTotal !== null ? money(openingTotal) : '—', numeric: openingTotal ?? undefined, format: money, loading: cashOpeningsQuery.isLoading, hint: t('sec_rep_opening_base_hint') },
  ];

  const times = (n: number) => (n === 1 ? t('sec_rep_time_one') : t('sec_rep_times', { n }));
  const visits = (n: number) => (n === 1 ? t('sec_rep_visit_one') : t('sec_rep_visits', { n }));
  const stockInfo = items.data ? { count: items.data.stock.reorder + items.data.stock.outOfStock, outOfStock: items.data.stock.outOfStock } : null;
  const stockValue = items.data ? items.data.inventoryValue : null;

  const paymentMethods: PaymentMethodView[] = report.paymentMethods.map((row) => ({ id: row.method, label: t(PAYMENT_METHOD_LABEL_KEY[row.method] ?? 'sale_pay_other'), amountLabel: money(row.total), percent: row.percent }));
  const employees: EmployeeView[] = report.employees.map((row) => ({ id: row.employeeId, name: row.employeeName || t('sec_rep_employee_unknown'), countLabel: times(row.count), amountLabel: money(row.total), percent: row.percent }));
  const cashSalesTotal = report.paymentMethods.find((row) => row.method === 'cash')?.total ?? 0;
  // "Total en Caja = Base Inicial + Ventas en Efectivo" (petición explícita): solo se muestra con una base real registrada.
  const cashBalanceView: CashBalanceView | null = openingTotal !== null ? { openingLabel: money(openingTotal), cashSalesLabel: money(cashSalesTotal), totalLabel: money(cashBalanceOf(openingTotal, report.paymentMethods)) } : null;

  const rangeFormat = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const rangeLabel = range
    ? range.current.days === 1
      ? rangeFormat.format(new Date(`${range.current.startDate}T12:00:00Z`))
      : `${rangeFormat.format(new Date(`${range.current.startDate}T12:00:00Z`))} – ${rangeFormat.format(new Date(`${addDays(range.current.startDate, range.current.days - 1)}T12:00:00Z`))}`
    : '';

  async function exportPdf() {
    if (!range) return;
    setExportingPdf(true);
    try {
      const logoDataUrl = await toDataUrl(resolveMedia(business.logoUrl));
      downloadReportsPdf({
        businessName: business.name,
        businessAddress: businessAddressLine(business.address, business.city, business.country),
        businessPhone: business.whatsapp || null,
        logoDataUrl,
        periodLabel: rangeLabel,
        generatedAtLabel: new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }).format(now),
        kpis: [
          { label: t('sec_rep_sales'), value: money(report.current.total) },
          { label: t('sec_rep_services'), value: String(report.current.count) },
          { label: t('sec_rep_avg'), value: report.current.average !== null ? money(report.current.average) : '—' },
          { label: t('sec_rep_new_clients'), value: report.newClients !== null ? String(report.newClients) : '—' },
          { label: t('sec_rep_opening_base'), value: openingTotal !== null ? money(openingTotal) : '—' },
        ],
        growth: growth
          ? { percentLabel: growth.percentLabel, statusText: t(growthTrend.percent === null ? 'sec_rep_growth_new' : growthTrend.direction === 'up' ? 'sec_rep_growth_up' : growthTrend.direction === 'down' ? 'sec_rep_growth_down' : 'sec_rep_growth_flat'), currentLabel: growth.currentLabel, previousLabel: growth.previousLabel }
          : null,
        cashBalance: cashBalanceView,
        paymentMethods,
        employees,
        topServices: report.services.map((row) => ({ name: row.label, countLabel: times(row.count), amountLabel: money(row.total) })),
        topProducts: report.products.map((row) => ({ name: row.label, countLabel: times(row.count), amountLabel: money(row.total) })),
        dailyRows: report.bars.map((bar) => ({ dateLabel: bar.tooltip.dateLabel, countLabel: bar.tooltip.countLabel, amountLabel: bar.tooltip.amountLabel })),
      });
    } finally {
      setExportingPdf(false);
    }
  }

  async function exportExcel() {
    if (!range) return;
    setExportingExcel(true);
    try {
      await downloadReportsExcel({
        periodLabel: rangeLabel,
        currency,
        kpis: { sales: report.current.total, services: report.current.count, average: report.current.average, growthPercent: growthTrend.percent, openingBase: openingTotal, cashTotal: openingTotal !== null ? cashBalanceOf(openingTotal, report.paymentMethods) : null },
        dailyRows: report.buckets.map((bucket) => ({ date: bucket.key, count: bucket.count, total: bucket.total, average: bucket.count > 0 ? Math.round(bucket.total / bucket.count) : 0 })),
        topServices: report.services,
        topProducts: report.products,
        employees: report.employees,
        paymentMethods: report.paymentMethods,
      });
    } finally {
      setExportingExcel(false);
    }
  }

  return (
    <Screen header={<Header root title={t('nav_reports')} subtitle={t('sec_reports_sub')} />}>
      <ReportsView
        t={t}
        period={period}
        onPeriod={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
        customError={customError}
        rangeLabel={rangeLabel}
        kpis={kpis}
        growth={growth}
        loading={dataLoading}
        empty={report.current.count === 0}
        bars={report.bars}
        topServices={report.services.map((row) => ({ id: row.label, name: row.label, value: money(row.total), sub: times(row.count) }))}
        topProducts={report.products.map((row) => ({ id: row.label, name: row.label, value: money(row.total), sub: times(row.count) }))}
        topClients={report.topClients.map((row) => ({ id: row.label, name: row.label, value: money(row.total), sub: visits(row.count) }))}
        paymentMethods={paymentMethods}
        cashBalance={cashBalanceView}
        employees={employees}
        stock={stockInfo ? { value: stockValue === null ? '—' : money(stockValue), low: stockInfo.count, href: `/inventory?status=${stockInfo.outOfStock > 0 ? 'out_of_stock' : 'reorder'}` } : null}
        note={truncated ? t('sec_rep_truncated', { n: RECORD_LIMIT }) : undefined}
        navigate={(href) => router.push(href as never)}
        onExportPdf={() => void exportPdf()}
        onExportExcel={() => void exportExcel()}
        exportingPdf={exportingPdf}
        exportingExcel={exportingExcel}
      />
    </Screen>
  );
}
