/**
 * Ruta "/" SOLO WEB (nativo: index.tsx, sin cambios). Panel de inicio: cabecera de cuenta, balance del día
 * (base inicial de caja; la API no registra ingresos del día, ver nota en el resumen de la fase), aviso de WhatsApp
 * del negocio y accesos rápidos. Presentación en src/web/screens/Home.tsx.
 */
import { useQueryClient } from '@tanstack/react-query';
import { addDays, formatMoney, type Currency } from '@xiro/shared';
import { actorOf, meets, type Requirement } from '@/lib/access';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { relativeTime } from '@/lib/alerts';
import { useCookieConsent } from '@/lib/useCookieConsent';
import { afterCloseNote, dailyCashFlow, flowShares, unbilledNote } from '@/lib/cashFlow';
import { buildActivity, variation, type Trend } from '@/lib/dashboard';
import { supportMessage, supportWhatsappUrl } from '@/lib/contact';
import { api, errorKey } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { dayRange, formatClock, formatDay, localDate, localTime, STATUS_TONE, summarizeItems, todayIn, upcoming } from '@/lib/agenda';
import { keys, useAppointments, useCashCloseSummary, useCashClosings, useCashToday, useClassification, useClientsSummary, useItemsQuery, useItemsSummary, useRecentClients, useRecentServiceRecords, useServiceRecordsSummary } from '@/lib/queries';
import { useAuthed, useSession } from '@/lib/session';
import { Brand } from '@/ui/Brand';
import { useDialogs } from '@/ui/Dialogs';
import { Screen } from '@/ui/Screen';
import { localDateKey } from '@/web/date';
import { DashboardView, type ActivityRowView, type CashFlowView } from '@/web/screens/Dashboard';
import type { KpiView } from '@/web/ui/Page';
import type { HomeAction } from '@/web/screens/Home';
import { photoToFormData } from '@/web/services/imageUpload.web';
import { useBusinessGreeting } from '@/web/services/useBusinessGreeting';
import { useNow } from '@/web/services/useNow';
import { useWebText } from '@/web/services/useWebText';
import { CashOpeningModal } from '@/web/ui/CashOpeningModal';
import { validatePhotoFile } from '@/web/ui/PhotoPicker';

const DISMISS_KEY = 'xiro.cashPrompt.dismissed';

function dismissedToday(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === localDateKey();
  } catch {
    return false;
  }
}
function dismissToday(): void {
  try {
    localStorage.setItem(DISMISS_KEY, localDateKey());
  } catch {
    /* almacenamiento bloqueado: se volverá a preguntar en la próxima carga, no es grave */
  }
}

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * "Subió 12% frente a ayer" / "Igual que ayer"; sin base de comparación no se inventa un porcentaje. `percent === -100`
 * significa "hoy va en cero": el día sigue en curso, así que compararlo contra un ayer ya cerrado no es justo todavía
 * (no se anuncia una "bajada del 100%" tan temprano, aunque matemáticamente lo sea).
 */
function trendView(trend: Trend, t: T): KpiView['trend'] {
  if (trend.direction === 'none') return undefined;
  if (trend.direction === 'flat') return { direction: 'flat', text: t('dash_trend_flat') };
  if (trend.percent === null) return { direction: 'up', text: t('dash_trend_up_new') };
  if (trend.direction === 'down' && trend.percent === -100) return { direction: 'down', text: t('dash_trend_down_zero') };
  return { direction: trend.direction, text: t(trend.direction === 'up' ? 'dash_trend_up' : 'dash_trend_down', { n: Math.abs(trend.percent) }) };
}

export default function HomeWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { user, business } = useAuthed();
  const { setBusiness } = useSession();
  const { toast } = useDialogs();
  const queryClient = useQueryClient();
  const isOwner = user.role === 'owner';
  const cash = useCashToday(isOwner);
  const fileInput = useRef<HTMLInputElement>(null);
  const greetingKey = useBusinessGreeting(business.timezone);
  const nowMs = useNow();

  // Datos del tablero: solo se consulta lo que esta persona puede ver (el servidor impone lo mismo).
  const viewer = actorOf(user);
  const canSales = meets(viewer, ['services_record']);
  const canClients = meets(viewer, ['clients_view']);
  const canCatalog = meets(viewer, ['catalog_view']);
  const canAgenda = meets(viewer, ['agenda_own']);
  const canReview = meets(viewer, ['catalog_manage']);
  const todayKey = todayIn(business.timezone);
  const week = useMemo(() => dayRange(todayKey, business.timezone, 7), [todayKey, business.timezone]);
  const appointments = useAppointments(week, canAgenda);
  const classification = useClassification(canReview);
  const currency = business.currency as Currency;
  const money = (amount: number) => formatMoney(amount, currency);

  // Indicadores de hoy contra ayer (día del negocio) y paneles, todo calculado en el servidor: sin listas completas.
  const todayRange = useMemo(() => dayRange(todayKey, business.timezone, 1), [todayKey, business.timezone]);
  const yesterdayRange = useMemo(() => dayRange(addDays(todayKey, -1), business.timezone, 1), [todayKey, business.timezone]);
  const salesToday = useServiceRecordsSummary(todayRange, canSales);
  const salesYesterday = useServiceRecordsSummary(yesterdayRange, canSales);
  const servicesToday = useServiceRecordsSummary({ ...todayRange, kind: 'service' }, canSales);
  const servicesYesterday = useServiceRecordsSummary({ ...yesterdayRange, kind: 'service' }, canSales);
  const recentRecords = useRecentServiceRecords(6, canSales);
  const clientsSummary = useClientsSummary(undefined, canClients);
  const recentClients = useRecentClients(6, canClients);
  const itemsSummary = useItemsSummary(canCatalog);
  const lowItems = useItemsQuery({ low: true, sort: 'stock', limit: 6 }, canCatalog);
  const recordsLoading = salesToday.isLoading || salesYesterday.isLoading || servicesToday.isLoading || servicesYesterday.isLoading;

  const dashboard = useMemo(
    () => ({
      days:
        salesToday.data && salesYesterday.data && servicesToday.data && servicesYesterday.data
          ? {
              today: { total: salesToday.data.total, count: salesToday.data.count },
              yesterday: { total: salesYesterday.data.total, count: salesYesterday.data.count },
              todayServices: { total: servicesToday.data.total, count: servicesToday.data.count },
              yesterdayServices: { total: servicesYesterday.data.total, count: servicesYesterday.data.count },
            }
          : null,
      summary: salesToday.data ?? null,
      newClients: clientsSummary.data ? { today: clientsSummary.data.newToday, yesterday: clientsSummary.data.newYesterday } : null,
      lowStock: (lowItems.data?.data ?? []).slice(0, 4),
      stockCounts: itemsSummary.data?.stock ?? null,
      activity: buildActivity({ records: recentRecords.data?.data, clients: recentClients.data?.data, items: lowItems.data?.data, limit: 6 }),
    }),
    [salesToday.data, salesYesterday.data, servicesToday.data, servicesYesterday.data, clientsSummary.data, lowItems.data, itemsSummary.data, recentRecords.data, recentClients.data],
  );

  const [manualCashOpen, setManualCashOpen] = useState(false);
  const [dismissed, setDismissed] = useState(dismissedToday);
  const [logoBusy, setLogoBusy] = useState(false);

  const opening = cash.data?.opening;
  // Primero el aviso de cookies del primer ingreso; la petición de abrir la caja espera a que se acepte.
  const cookies = useCookieConsent();
  const autoPrompt = isOwner && cash.isSuccess && !opening && !dismissed && !cookies.visible;
  const cashModalOpen = manualCashOpen || autoPrompt;

  const closeCashModal = () => {
    setManualCashOpen(false);
    if (!opening) {
      setDismissed(true);
      dismissToday();
    }
  };

  async function submitCashOpening(input: { amount: number; note: string }) {
    try {
      await api.openCash(input);
      await queryClient.invalidateQueries({ queryKey: keys.cash });
      // El flujo de caja del día también cambia (pasa a "caja abierta" con su base).
      await queryClient.invalidateQueries({ queryKey: keys.cashCloseSummary });
      setManualCashOpen(false);
      setDismissed(true);
      dismissToday();
      return { ok: true };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false, general: result.general ?? Object.values(result.fields)[0] };
    }
  }

  async function onLogoFile(file: File | undefined) {
    if (!file) return;
    const problem = validatePhotoFile(file);
    if (problem) return toast(t(problem));
    const uri = URL.createObjectURL(file);
    setLogoBusy(true);
    try {
      setBusiness(await api.uploadLogo(await photoToFormData({ uri }, 'logo')));
    } catch (error) {
      toast(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      URL.revokeObjectURL(uri);
      setLogoBusy(false);
    }
  }

  const actor = actorOf(user);
  const allActions: Array<HomeAction & { requires?: Requirement }> = [
    { id: 'new_sale', icon: 'coins', label: t('new_sale'), href: '/sale/new', requires: ['services_record'] },
    { id: 'appointments', icon: 'calendar-days', label: t('appointments'), href: '/agenda', requires: ['agenda_own'] },
    { id: 'catalog', icon: 'book-open', label: t('catalog'), href: '/catalog', requires: ['catalog_view'] },
    { id: 'inventory', icon: 'package', label: t('inventory'), href: '/inventory', requires: ['catalog_view'] },
    { id: 'cash_close', icon: 'receipt', label: t('cash_close'), href: '/cash-close', requires: 'owner' },
    // Finanzas: abre Gastos con el formulario de alta ya abierto.
    { id: 'register_expense', icon: 'wallet', label: t('home_register_expense'), href: '/expenses?new=1', requires: ['finance'] },
    { id: 'clients', icon: 'users', label: t('clients'), href: '/clients', requires: ['clients_view'] },
  ];
  const actions: HomeAction[] = allActions.filter((action) => meets(actor, action.requires)).map((action) => ({ id: action.id, icon: action.icon, label: action.label, href: action.href, soon: action.soon }));

  const salesTrend = dashboard.days ? variation(dashboard.days.today.total, dashboard.days.yesterday.total) : null;
  // Valor en pesos de los SERVICIOS de hoy (sin productos), no la cantidad de registros: la variación también se mide
  // sobre ese valor, no sobre el conteo, para que la flecha de "Servicios hoy" hable del mismo dato que su cifra grande.
  const servicesTrend = dashboard.days ? variation(dashboard.days.todayServices.total, dashboard.days.yesterdayServices.total) : null;
  const clientsTrend = dashboard.newClients ? variation(dashboard.newClients.today, dashboard.newClients.yesterday) : null;
  const servicesCount = dashboard.days?.todayServices.count ?? 0;
  const kpis: KpiView[] = [
    ...(canSales
      ? [
          { id: 'sales', icon: 'coins' as const, label: t('dash_kpi_sales'), value: dashboard.days ? money(dashboard.days.today.total) : '—', loading: recordsLoading, trend: salesTrend ? trendView(salesTrend, t) : undefined, onPress: () => router.push('/sales-today') },
          {
            id: 'services',
            icon: 'scissors' as const,
            label: t('dash_kpi_services'),
            value: dashboard.days ? money(dashboard.days.todayServices.total) : '—',
            hint: dashboard.days ? t(servicesCount === 1 ? 'dash_kpi_services_count_one' : 'dash_kpi_services_count', { n: servicesCount }) : undefined,
            loading: recordsLoading,
            trend: servicesTrend ? trendView(servicesTrend, t) : undefined,
            onPress: () => router.push('/sales-today?kind=service'),
          },
        ]
      : []),
    ...(canAgenda
      ? [
          {
            id: 'appointments',
            icon: 'calendar-days' as const,
            label: t('dash_kpi_appointments'),
            value: appointments.data ? String(appointments.data.filter((a) => localDate(a.startsAt, business.timezone) === todayKey && a.status !== 'cancelled' && a.status !== 'no_show').length) : '—',
            loading: appointments.isLoading,
            onPress: () => router.push('/agenda'),
          },
        ]
      : []),
    ...(canClients ? [{ id: 'clients', icon: 'users' as const, label: t('dash_kpi_clients'), value: dashboard.newClients ? String(dashboard.newClients.today) : '—', loading: clientsSummary.isLoading, trend: clientsTrend ? trendView(clientsTrend, t) : undefined, onPress: () => router.push('/clients?since=today') }] : []),
    ...(isOwner ? [{ id: 'cash', icon: 'wallet' as const, label: t('available_balance'), value: opening ? money(opening.amount) : '—', loading: cash.isLoading, hint: opening ? undefined : t('cash_not_opened'), onPress: () => setManualCashOpen(true) }] : []),
  ];

  /* ---------- Flujo de caja diario (solo el dueño: el resumen de caja es suyo, el servidor exige lo mismo) ---------- */
  const daySummary = useCashCloseSummary(todayKey, isOwner);
  const todayClosings = useCashClosings(isOwner ? { from: todayKey, to: todayKey } : null, isOwner);
  const cashFlow: CashFlowView | null = isOwner
    ? (() => {
        const base = { closeHref: '/cash-close' };
        if (daySummary.isLoading) return { ...base, loading: true, net: '', netTone: 'neutral', income: '', expenses: '', incomeShare: 0, expenseShare: 0, empty: false, methods: [], cash: { kind: 'closed' } };
        if (!daySummary.data) return { ...base, loading: false, error: t(errorKey(daySummary.error)), net: '', netTone: 'neutral', income: '', expenses: '', incomeShare: 0, expenseShare: 0, empty: false, methods: [], cash: { kind: 'closed' } };
        const flow = dailyCashFlow(daySummary.data, todayClosings.data ?? []);
        const shares = flowShares(flow);
        const delta = flow.cash.state === 'open' ? flow.cash.current - flow.cash.opening : 0;
        return {
          ...base,
          loading: false,
          net: money(flow.net),
          netTone: flow.net > 0 ? 'success' : flow.net < 0 ? 'danger' : 'neutral',
          income: money(flow.income),
          expenses: money(flow.expenses),
          incomeShare: shares.income,
          expenseShare: shares.expenses,
          empty: flow.income === 0 && flow.expenses === 0,
          tipsNote: flow.tips > 0 ? t('home_cf_tips', { amount: money(flow.tips) }) : undefined,
          unbilledNote: unbilledNote(flow.unbilled, money, t),
          methods: flow.methods.map((m) => ({ id: m.method, label: t(`sale_pay_${m.method}`), value: money(m.total) })),
          cash:
            flow.cash.state === 'open'
              ? { kind: 'open', current: money(flow.cash.current), base: money(flow.cash.opening), delta: t('home_cf_since_open', { amount: `${delta > 0 ? '+' : ''}${money(delta)}` }), deltaTone: delta > 0 ? 'success' : delta < 0 ? 'danger' : 'neutral' }
              : flow.cash.state === 'closed'
                ? { kind: 'closed', afterClose: afterCloseNote(flow.afterClose, money, t) }
                : { kind: 'not_opened', onOpen: () => setManualCashOpen(true) },
        };
      })()
    : null;

  const summary = canSales
    ? {
        loading: recordsLoading,
        empty: dashboard.summary?.count === 0,
        rows:
          dashboard.summary && dashboard.summary.count > 0
            ? [
                { id: 'count', label: t('dash_summary_services'), value: String(dashboard.summary.count) },
                { id: 'total', label: t('dash_summary_total'), value: money(dashboard.summary.total) },
                ...(dashboard.summary.average !== null ? [{ id: 'average', label: t('dash_summary_average'), value: money(dashboard.summary.average) }] : []),
                ...(dashboard.summary.topLabel ? [{ id: 'top', label: t('dash_summary_top'), value: dashboard.summary.topLabel }] : []),
              ]
            : [],
      }
    : null;

  const stock = canCatalog
    ? {
        loading: lowItems.isLoading,
        allHref: `/inventory?status=${dashboard.stockCounts && dashboard.stockCounts.outOfStock > 0 ? 'out_of_stock' : 'reorder'}`,
        rows: dashboard.lowStock.map((item) => ({ id: item.id, name: item.name, out: item.stockStatus === 'out_of_stock', badge: item.stockStatus === 'out_of_stock' ? t('dash_stock_out') : t('dash_stock_units', { n: item.stock }), href: `/item/${item.id}` })),
      }
    : null;

  const appointmentsPanel = canAgenda
    ? {
        loading: appointments.isLoading,
        allHref: '/agenda',
        rows: upcoming(appointments.data ?? [], new Date(nowMs), 5).map((appt) => ({
          id: appt.id,
          day: formatDay(localDate(appt.startsAt, business.timezone), language, { weekday: 'short', day: 'numeric' }),
          time: formatClock(localTime(appt.startsAt, business.timezone), language),
          client: appt.client.name,
          detail: summarizeItems(appt.items),
          status: t(`appt_status_${appt.status}`),
          tone: STATUS_TONE[appt.status],
          href: '/agenda',
        })),
      }
    : null;
  const reviewBanner = canReview && classification.data && classification.data.length > 0 ? { count: classification.data.length, href: '/review-items' } : null;

  const activityRows: ActivityRowView[] = dashboard.activity.map((event) => ({
    id: event.id,
    icon: event.kind === 'service' ? 'scissors' : event.kind === 'client' ? 'user' : 'package',
    title: event.kind === 'service' ? t('dash_activity_service', { name: event.primary }) : event.primary,
    detail: event.kind === 'service' ? event.secondary : event.kind === 'client' ? t('dash_activity_client') : `${t('dash_activity_stock')} · ${t('dash_stock_units', { n: event.units ?? 0 })}`,
    time: relativeTime(event.at, nowMs, language),
    amount: event.amount !== undefined ? money(event.amount) : undefined,
  }));
  const activity = canSales || canClients || canCatalog ? { loading: (canSales && recentRecords.isLoading) || (canClients && recentClients.isLoading) || (canCatalog && lowItems.isLoading), rows: activityRows } : null;

  return (
    <>
      {/* Igual que el resto de pantallas: el scroll vive dentro de <Screen> (el body no hace scroll, ver dist/index.html). */}
      <Screen>
        <DashboardView
          t={t}
          greeting={t(greetingKey)}
          businessName={business.name}
          logo={<Brand size={72} logoUrl={business.logoUrl} />}
          heroUrl={business.logoUrl}
          onChangeLogo={() => fileInput.current?.click()}
          logoBusy={logoBusy}
          kpis={kpis}
          cashFlow={cashFlow}
          actions={actions}
          needsWhatsappSetup={isOwner && !business.whatsapp}
          onGoBusinessSettings={() => router.push('/business')}
          summary={summary}
          stock={stock}
          activity={activity}
          appointments={appointmentsPanel}
          reviewBanner={reviewBanner}
          navigate={(href) => router.navigate(href as never)}
          year={new Date(nowMs).getFullYear()}
          supportHref={supportWhatsappUrl(supportMessage(language, business.name))}
        />
      </Screen>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="xw-sr"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ''; // permite volver a elegir el mismo archivo
          void onLogoFile(file);
        }}
      />
      {isOwner ? <CashOpeningModal open={cashModalOpen} onClose={closeCashModal} currentAmount={opening?.amount ?? 0} currency={business.currency} t={t} onSubmit={submitCashOpening} onSkip={closeCashModal} /> : null}
    </>
  );
}
