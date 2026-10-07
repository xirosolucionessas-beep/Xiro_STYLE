/**
 * Reportes en Android/iOS (en la Web esta ruta la sirve reports.web.tsx con su propio diseño). Mismos datos y mismas
 * cuentas que la web: ventas reales del periodo (`GET /api/sales?from&to`) y del periodo anterior equivalente, bases de
 * caja, clientes e inventario, todo calculado con las funciones de `lib/sections` (que a su vez usan
 * `@xiro/shared/reports`). El PDF y el Excel salen del MISMO generador que la web (`lib/exports`); en el teléfono se
 * guardan o comparten desde la hoja del sistema. También comparte un resumen en texto (WhatsApp, correo, notas…).
 */
import { addDays, formatMoney, todayIn, type Currency, type ReportPeriod } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Share } from 'react-native';
import { resolveMedia } from '@/lib/api';
import { variation, type Trend } from '@/lib/dashboard';
import { businessAddressLine } from '@/lib/exports/address';
import { imageDataUrl, shareGeneratedFile, type ShareResult } from '@/lib/exports/nativeFiles';
import { buildReportsWorkbook, reportsExcelFileName } from '@/lib/exports/reportsExcel';
import { buildReportsPdf, reportsPdfFileName } from '@/lib/exports/reportsPdf';
import { lowStock } from '@/lib/homeMetrics';
import { useCashOpenings, useClients, useItems, useSales } from '@/lib/queries';
import {
  cashBalance as cashBalanceOf,
  employeePerformance,
  inventoryValue,
  isTruncated,
  newClientsInPeriod,
  openingBaseTotal,
  paymentMethodBreakdown,
  reportBuckets,
  resolveReportRange,
  RECORD_LIMIT,
  salesSummary,
  topSaleClients,
  topSaleItems,
} from '@/lib/sections';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useDialogs } from '@/ui/Dialogs';
import { ReportsView, type ReportBar, type ReportKpi, type ShareRow } from '@/ui/reports/ReportsView';
import { Header, Screen } from '@/ui/Screen';

type T = (key: string, params?: Record<string, string | number>) => string;

/** Variación frente al periodo anterior; sin base de comparación no se inventa un porcentaje (igual que la web). */
function trendView(trend: Trend, t: T): ReportKpi['trend'] {
  if (trend.direction === 'none') return undefined;
  if (trend.direction === 'flat') return { direction: 'flat', text: t('sec_trend_flat') };
  if (trend.percent === null) return { direction: 'up', text: t('sec_trend_new') };
  return { direction: trend.direction, text: t(trend.direction === 'up' ? 'sec_trend_up' : 'sec_trend_down', { n: Math.abs(trend.percent) }) };
}

const PAYMENT_METHOD_LABEL_KEY: Record<string, string> = { cash: 'sale_pay_cash', card: 'sale_pay_card', nequi: 'sale_pay_nequi', bank_transfer: 'sale_pay_bank_transfer', other: 'sale_pay_other' };

export default function Reports() {
  const router = useRouter();
  const { t, language } = useSettings();
  const { business } = useAuthed();
  const { toast } = useDialogs();
  const [period, setPeriod] = useState<ReportPeriod>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const currency = business.currency as Currency;
  const money = (amount: number) => formatMoney(amount, currency);

  // La hora se fija al cambiar de periodo (no en cada render): así las consultas no cambian de clave sin parar.
  const now = useMemo(() => new Date(), [period, customFrom, customTo]);
  const today = todayIn(business.timezone, now);
  const range = useMemo(() => {
    try {
      return resolveReportRange(period, business.timezone, now, period === 'custom' ? { from: customFrom, to: customTo } : undefined);
    } catch {
      return null;
    }
  }, [period, business.timezone, now, customFrom, customTo]);
  // Sin fechas todavía no es un error: solo se avisa cuando ambas están puestas y al revés.
  const customError = period === 'custom' && customFrom && customTo && !range ? t('sec_period_invalid_range') : undefined;

  const salesCurrent = useSales(range?.current ?? null, Boolean(range));
  const salesPrevious = useSales(range?.previous ?? null, Boolean(range));
  const cashOpeningsQuery = useCashOpenings(range ? { from: range.current.startDate, to: addDays(range.current.startDate, range.current.days - 1) } : null, Boolean(range));
  const clients = useClients('');
  const items = useItems();

  const report = useMemo(() => {
    const currentSales = salesCurrent.data ?? [];
    const previousSales = salesPrevious.data ?? [];
    const dayFormat = new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const weekday = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' });
    const monthFormat = new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' });
    const monthYear = new Intl.DateTimeFormat(language, { month: 'short', year: 'numeric', timeZone: 'UTC' });

    const buckets = range ? reportBuckets(currentSales, business.timezone, range.current) : [];
    const peak = Math.max(0, ...buckets.map((bucket) => bucket.total));
    const isMonthly = (range?.current.days ?? 0) > 35;
    const bars: ReportBar[] = buckets.map((bucket, index) => {
      const isMonthKey = /^\d{4}-\d{2}$/.test(bucket.key);
      const at = new Date(isMonthKey ? `${bucket.key}-01T12:00:00Z` : `${bucket.key}T12:00:00Z`);
      // En pantallas angostas se etiqueta uno de cada 5 días (más el último) para que el eje no se amontone.
      const showLabel = isMonthly || buckets.length <= 7 || index % 5 === buckets.length % 5 || index === buckets.length - 1;
      return {
        key: bucket.key,
        label: showLabel ? (isMonthly ? monthFormat.format(at) : buckets.length <= 7 ? weekday.format(at) : String(Number(bucket.key.slice(8)))) : '',
        height: peak > 0 ? bucket.total / peak : 0,
        dateLabel: isMonthKey ? monthYear.format(at) : dayFormat.format(at),
        amountLabel: `${t('sec_rep_sales')}: ${money(bucket.total)}`,
        countLabel: `${t('sec_rep_services')}: ${bucket.count}`,
      };
    });

    return {
      buckets,
      current: salesSummary(currentSales),
      previous: salesSummary(previousSales),
      bars,
      services: topSaleItems(currentSales, 'service'),
      products: topSaleItems(currentSales, 'product'),
      topClients: topSaleClients(currentSales),
      paymentMethods: paymentMethodBreakdown(currentSales),
      employees: employeePerformance(currentSales),
      newClients: clients.data && range ? newClientsInPeriod(clients.data, business.timezone, range.current.days, now) : null,
    };
    // `money`/`t` solo dependen de moneda e idioma, ya listados.
  }, [salesCurrent.data, salesPrevious.data, clients.data, range, business.timezone, now, language, currency]);

  const dataLoading = Boolean(range) && (salesCurrent.isLoading || salesPrevious.isLoading);
  const truncated = salesCurrent.data ? isTruncated(salesCurrent.data) : false;
  const growthTrend = variation(report.current.total, report.previous.total);
  const growthStatus = t(growthTrend.direction === 'none' ? 'sec_rep_growth_none' : growthTrend.percent === null ? 'sec_rep_growth_new' : growthTrend.direction === 'up' ? 'sec_rep_growth_up' : growthTrend.direction === 'down' ? 'sec_rep_growth_down' : 'sec_rep_growth_flat');
  const growth =
    range && !dataLoading
      ? {
          direction: growthTrend.direction,
          percentLabel: growthTrend.percent === null ? null : `${growthTrend.percent >= 0 ? '+' : ''}${growthTrend.percent}%`,
          statusText: growthStatus,
          currentLabel: money(report.current.total),
          previousLabel: money(report.previous.total),
        }
      : null;

  const openingTotal = range && cashOpeningsQuery.data ? openingBaseTotal(cashOpeningsQuery.data) : null;

  // Rango inválido o incompleto: ningún indicador inventa un "0" con tendencia — se muestran sin dato.
  const kpis: ReportKpi[] = [
    { id: 'sales', icon: 'cash-outline', label: t('sec_rep_sales'), value: range ? money(report.current.total) : '—', loading: dataLoading, trend: range && !truncated ? trendView(growthTrend, t) : undefined },
    { id: 'services', icon: 'cut-outline', label: t('sec_rep_services'), value: range ? String(report.current.count) : '—', loading: dataLoading, trend: range && !truncated ? trendView(variation(report.current.count, report.previous.count), t) : undefined },
    { id: 'avg', icon: 'receipt-outline', label: t('sec_rep_avg'), value: range && report.current.average !== null ? money(report.current.average) : '—', loading: dataLoading },
    { id: 'clients', icon: 'people-outline', label: t('sec_rep_new_clients'), value: range && report.newClients !== null ? String(report.newClients) : '—', loading: clients.isLoading },
    { id: 'opening', icon: 'wallet-outline', label: t('sec_rep_opening_base'), value: openingTotal !== null ? money(openingTotal) : '—', loading: Boolean(range) && cashOpeningsQuery.isLoading, hint: t('sec_rep_opening_base_hint') },
  ];

  const times = (n: number) => (n === 1 ? t('sec_rep_time_one') : t('sec_rep_times', { n }));
  const visits = (n: number) => (n === 1 ? t('sec_rep_visit_one') : t('sec_rep_visits', { n }));
  const stockInfo = items.data ? lowStock(items.data) : null;
  const stockValue = items.data ? inventoryValue(items.data) : null;

  const paymentMethods: ShareRow[] = report.paymentMethods.map((row) => ({ id: row.method, label: t(PAYMENT_METHOD_LABEL_KEY[row.method] ?? 'sale_pay_other'), amountLabel: money(row.total), percent: row.percent }));
  const employees: ShareRow[] = report.employees.map((row) => ({ id: row.employeeId, label: row.employeeName || t('sec_rep_employee_unknown'), amountLabel: money(row.total), sub: `${times(row.count)} · ${t('sec_rep_percent_of_total', { n: row.percent })}`, percent: row.percent }));
  const cashSalesTotal = report.paymentMethods.find((row) => row.method === 'cash')?.total ?? 0;
  // "Total en caja = Base inicial + Ventas en efectivo": solo con una base real registrada (igual que la web).
  const cashBalance = openingTotal !== null ? { openingLabel: money(openingTotal), cashSalesLabel: money(cashSalesTotal), totalLabel: money(cashBalanceOf(openingTotal, report.paymentMethods)) } : null;

  const rangeFormat = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const rangeLabel = range
    ? range.current.days === 1
      ? rangeFormat.format(new Date(`${range.current.startDate}T12:00:00Z`))
      : `${rangeFormat.format(new Date(`${range.current.startDate}T12:00:00Z`))} – ${rangeFormat.format(new Date(`${addDays(range.current.startDate, range.current.days - 1)}T12:00:00Z`))}`
    : '';

  const share = async () => {
    if (!range) return;
    const lines = [
      t('rep_share_title', { business: business.name }),
      rangeLabel,
      '',
      ...kpis.map((kpi) => `${kpi.label}: ${kpi.value}`),
      growth?.percentLabel ? `${growth.statusText}: ${growth.percentLabel}` : '',
      cashBalance ? `${t('sec_rep_cash_total')}: ${cashBalance.totalLabel}` : '',
      ...(paymentMethods.length ? ['', t('sec_rep_payment_methods'), ...paymentMethods.map((row) => `• ${row.label}: ${row.amountLabel} (${row.percent}%)`)] : []),
      ...(report.services.length ? ['', t('sec_rep_top_services'), ...report.services.map((row) => `• ${row.label}: ${money(row.total)} (${times(row.count)})`)] : []),
      ...(report.products.length ? ['', t('sec_rep_top_products'), ...report.products.map((row) => `• ${row.label}: ${money(row.total)} (${times(row.count)})`)] : []),
    ].filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''));
    try {
      await Share.share({ title: t('rep_share_title', { business: business.name }), message: lines.join('\n') });
    } catch {
      toast(t('unknown_error'));
    }
  };

  const afterShare = (result: ShareResult) => {
    if (result === 'unavailable') toast(t('rep_share_unavailable'));
  };

  async function exportPdf() {
    if (!range) return;
    setExportingPdf(true);
    try {
      const logoDataUrl = await imageDataUrl(resolveMedia(business.logoUrl), 600);
      const doc = buildReportsPdf({
        businessName: business.name,
        businessAddress: businessAddressLine(business.address, business.city, business.country),
        businessPhone: business.whatsapp || null,
        logoDataUrl,
        periodLabel: rangeLabel,
        generatedAtLabel: new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }).format(new Date()),
        kpis: [
          { label: t('sec_rep_sales'), value: money(report.current.total) },
          { label: t('sec_rep_services'), value: String(report.current.count) },
          { label: t('sec_rep_avg'), value: report.current.average !== null ? money(report.current.average) : '—' },
          { label: t('sec_rep_new_clients'), value: report.newClients !== null ? String(report.newClients) : '—' },
          { label: t('sec_rep_opening_base'), value: openingTotal !== null ? money(openingTotal) : '—' },
        ],
        growth: growth ? { percentLabel: growth.percentLabel, statusText: growth.statusText, currentLabel: growth.currentLabel, previousLabel: growth.previousLabel } : null,
        cashBalance,
        paymentMethods: paymentMethods.map((row) => ({ id: row.id, label: row.label, amountLabel: row.amountLabel, percent: row.percent })),
        employees: report.employees.map((row) => ({ id: row.employeeId, name: row.employeeName || t('sec_rep_employee_unknown'), countLabel: times(row.count), amountLabel: money(row.total), percent: row.percent })),
        topServices: report.services.map((row) => ({ name: row.label, countLabel: times(row.count), amountLabel: money(row.total) })),
        topProducts: report.products.map((row) => ({ name: row.label, countLabel: times(row.count), amountLabel: money(row.total) })),
        dailyRows: report.bars.map((bar) => ({ dateLabel: bar.dateLabel, countLabel: bar.countLabel, amountLabel: bar.amountLabel })),
      });
      afterShare(await shareGeneratedFile(reportsPdfFileName(rangeLabel), new Uint8Array(doc.output('arraybuffer')), 'pdf', t('sec_rep_export_pdf')));
    } catch {
      toast(t('rep_export_failed'));
    } finally {
      setExportingPdf(false);
    }
  }

  async function exportExcel() {
    if (!range) return;
    setExportingExcel(true);
    try {
      const workbook = buildReportsWorkbook({
        periodLabel: rangeLabel,
        currency,
        kpis: { sales: report.current.total, services: report.current.count, average: report.current.average, growthPercent: growthTrend.percent, openingBase: openingTotal, cashTotal: openingTotal !== null ? cashBalanceOf(openingTotal, report.paymentMethods) : null },
        dailyRows: report.buckets.map((bucket) => ({ date: bucket.key, count: bucket.count, total: bucket.total, average: bucket.count > 0 ? Math.round(bucket.total / bucket.count) : 0 })),
        topServices: report.services,
        topProducts: report.products,
        employees: report.employees,
        paymentMethods: report.paymentMethods,
      });
      const buffer = await workbook.xlsx.writeBuffer();
      afterShare(await shareGeneratedFile(reportsExcelFileName(rangeLabel), new Uint8Array(buffer as ArrayBuffer), 'xlsx', t('sec_rep_export_excel')));
    } catch {
      toast(t('rep_export_failed'));
    } finally {
      setExportingExcel(false);
    }
  }

  const refresh = () => void Promise.all([salesCurrent.refetch(), salesPrevious.refetch(), cashOpeningsQuery.refetch(), clients.refetch(), items.refetch()]);

  return (
    <Screen header={<Header title={t('menu_reports')} subtitle={t('sec_reports_sub')} />} refreshing={salesCurrent.isRefetching} onRefresh={refresh}>
      <ReportsView
        period={period}
        onPeriod={setPeriod}
        today={today}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
        customError={customError || undefined}
        rangeLabel={rangeLabel}
        kpis={kpis}
        growth={growth}
        loading={dataLoading}
        empty={!dataLoading && report.current.count === 0}
        bars={report.bars}
        cashBalance={cashBalance}
        paymentMethods={paymentMethods}
        employees={employees}
        topServices={report.services.map((row) => ({ id: row.label, name: row.label, value: money(row.total), sub: times(row.count) }))}
        topProducts={report.products.map((row) => ({ id: row.label, name: row.label, value: money(row.total), sub: times(row.count) }))}
        topClients={report.topClients.map((row) => ({ id: row.label, name: row.label, value: money(row.total), sub: visits(row.count) }))}
        stock={stockInfo ? { value: stockValue === null ? '—' : money(stockValue), low: stockInfo.count, onPress: () => router.push(`/inventory?status=${stockInfo.outOfStock > 0 ? 'out_of_stock' : 'reorder'}`) } : null}
        note={truncated ? t('sec_rep_truncated', { n: RECORD_LIMIT }) : undefined}
        onShare={() => void share()}
        onExportPdf={() => void exportPdf()}
        onExportExcel={() => void exportExcel()}
        exportingPdf={exportingPdf}
        exportingExcel={exportingExcel}
      />
    </Screen>
  );
}
