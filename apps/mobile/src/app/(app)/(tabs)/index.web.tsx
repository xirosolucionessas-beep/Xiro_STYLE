/**
 * Ruta "/" SOLO WEB (nativo: index.tsx, sin cambios). Panel de inicio: cabecera de cuenta, balance del día
 * (base inicial de caja; la API no registra ingresos del día, ver nota en el resumen de la fase), aviso de WhatsApp
 * del negocio y accesos rápidos. Presentación en src/web/screens/Home.tsx.
 */
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, type Currency } from '@xiro/shared';
import { actorOf, meets, type Requirement } from '@/lib/access';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { relativeTime } from '@/lib/alerts';
import { buildActivity, daySummary, lowStockList, newClients, serviceDays, variation, type Trend } from '@/lib/dashboard';
import { supportMessage, supportWhatsappUrl } from '@/lib/contact';
import { lowStock } from '@/lib/homeMetrics';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { keys, useCashToday, useClients, useItems, useServiceRecords } from '@/lib/queries';
import { useAuthed, useSession } from '@/lib/session';
import { Brand } from '@/ui/Brand';
import { useDialogs } from '@/ui/Dialogs';
import { Screen } from '@/ui/Screen';
import { localDateKey } from '@/web/date';
import { DashboardView, type ActivityRowView, type KpiView } from '@/web/screens/Dashboard';
import type { HomeAction } from '@/web/screens/Home';
import { useAssistant } from '@/web/shell/assistantContext';
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

/** "Subió 12% frente a ayer" / "Igual que ayer"; sin base de comparación no se inventa un porcentaje. */
function trendView(trend: Trend, t: T): KpiView['trend'] {
  if (trend.direction === 'none') return undefined;
  if (trend.direction === 'flat') return { direction: 'flat', text: t('dash_trend_flat') };
  if (trend.percent === null) return { direction: 'up', text: t('dash_trend_up_new') };
  return { direction: trend.direction, text: t(trend.direction === 'up' ? 'dash_trend_up' : 'dash_trend_down', { n: Math.abs(trend.percent) }) };
}

export default function HomeWeb() {
  const router = useRouter();
  const assistant = useAssistant();
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
  const records = useServiceRecords(undefined, canSales);
  const clients = useClients('', canClients);
  const items = useItems(canCatalog);
  const currency = business.currency as Currency;
  const money = (amount: number) => formatMoney(amount, currency);

  const dashboard = useMemo(() => {
    const now = new Date(nowMs);
    return {
      days: records.data ? serviceDays(records.data, business.timezone, now) : null,
      summary: records.data ? daySummary(records.data, business.timezone, now) : null,
      newClients: clients.data ? newClients(clients.data, business.timezone, now) : null,
      lowStock: items.data ? lowStockList(items.data, 4) : [],
      stockCounts: items.data ? lowStock(items.data) : null,
      activity: buildActivity({ records: records.data, clients: clients.data, items: items.data, limit: 6 }),
    };
  }, [records.data, clients.data, items.data, business.timezone, nowMs]);

  const [manualCashOpen, setManualCashOpen] = useState(false);
  const [dismissed, setDismissed] = useState(dismissedToday);
  const [logoBusy, setLogoBusy] = useState(false);

  const opening = cash.data?.opening;
  const autoPrompt = isOwner && cash.isSuccess && !opening && !dismissed;
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
    { id: 'new_service', icon: 'plus', label: t('new_service'), href: '/item/form', requires: ['catalog_manage'] },
    { id: 'appointments', icon: 'calendar-days', label: t('appointments'), soon: true, requires: 'owner' },
    { id: 'catalog', icon: 'book-open', label: t('catalog'), href: '/catalog', requires: ['catalog_view'] },
    { id: 'inventory', icon: 'package', label: t('inventory'), href: '/inventory', requires: ['catalog_view'] },
    { id: 'cash_close', icon: 'receipt', label: t('cash_close'), soon: true, requires: 'owner' },
    { id: 'clients', icon: 'users', label: t('clients'), href: '/clients', requires: ['clients_view'] },
  ];
  const actions: HomeAction[] = allActions.filter((action) => meets(actor, action.requires)).map((action) => ({ id: action.id, icon: action.icon, label: action.label, href: action.href, soon: action.soon }));

  const salesTrend = dashboard.days ? variation(dashboard.days.today.total, dashboard.days.yesterday.total) : null;
  const servicesTrend = dashboard.days ? variation(dashboard.days.today.count, dashboard.days.yesterday.count) : null;
  const clientsTrend = dashboard.newClients ? variation(dashboard.newClients.today, dashboard.newClients.yesterday) : null;
  const kpis: KpiView[] = [
    ...(canSales
      ? [
          { id: 'sales', icon: 'coins' as const, label: t('dash_kpi_sales'), value: dashboard.days ? money(dashboard.days.today.total) : '—', loading: records.isLoading, trend: salesTrend ? trendView(salesTrend, t) : undefined, onPress: () => router.push('/loyalty') },
          { id: 'services', icon: 'scissors' as const, label: t('dash_kpi_services'), value: dashboard.days ? String(dashboard.days.today.count) : '—', loading: records.isLoading, trend: servicesTrend ? trendView(servicesTrend, t) : undefined },
        ]
      : []),
    ...(canClients ? [{ id: 'clients', icon: 'users' as const, label: t('dash_kpi_clients'), value: dashboard.newClients ? String(dashboard.newClients.today) : '—', loading: clients.isLoading, trend: clientsTrend ? trendView(clientsTrend, t) : undefined, onPress: () => router.navigate('/clients') }] : []),
    ...(isOwner ? [{ id: 'cash', icon: 'wallet' as const, label: t('available_balance'), value: opening ? money(opening.amount) : '—', loading: cash.isLoading, hint: opening ? undefined : t('cash_not_opened'), onPress: () => setManualCashOpen(true) }] : []),
  ];

  const summary = canSales
    ? {
        loading: records.isLoading,
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
        loading: items.isLoading,
        allHref: `/inventory?status=${dashboard.stockCounts && dashboard.stockCounts.outOfStock > 0 ? 'out_of_stock' : 'reorder'}`,
        rows: dashboard.lowStock.map((item) => ({ id: item.id, name: item.name, out: item.stockStatus === 'out_of_stock', badge: item.stockStatus === 'out_of_stock' ? t('dash_stock_out') : t('dash_stock_units', { n: item.stock }), href: `/item/${item.id}` })),
      }
    : null;

  const activityRows: ActivityRowView[] = dashboard.activity.map((event) => ({
    id: event.id,
    icon: event.kind === 'service' ? 'scissors' : event.kind === 'client' ? 'user' : 'package',
    title: event.kind === 'service' ? t('dash_activity_service', { name: event.primary }) : event.primary,
    detail: event.kind === 'service' ? event.secondary : event.kind === 'client' ? t('dash_activity_client') : `${t('dash_activity_stock')} · ${t('dash_stock_units', { n: event.units ?? 0 })}`,
    time: relativeTime(event.at, nowMs, language),
    amount: event.amount !== undefined ? money(event.amount) : undefined,
  }));
  const activity = canSales || canClients || canCatalog ? { loading: (canSales && records.isLoading) || (canClients && clients.isLoading) || (canCatalog && items.isLoading), rows: activityRows } : null;

  return (
    <>
      {/* Igual que el resto de pantallas: el scroll vive dentro de <Screen> (el body no hace scroll, ver dist/index.html). */}
      <Screen>
        <DashboardView
          t={t}
          greeting={t(greetingKey)}
          businessName={business.name}
          userName={user.name}
          businessSlug={business.slug}
          logo={<Brand size={72} logoUrl={business.logoUrl} />}
          heroUrl={business.logoUrl}
          onChangeLogo={() => fileInput.current?.click()}
          logoBusy={logoBusy}
          onEditProfile={() => router.push('/profile')}
          kpis={kpis}
          actions={actions}
          needsWhatsappSetup={isOwner && !business.whatsapp}
          onGoBusinessSettings={() => router.push('/business')}
          summary={summary}
          stock={stock}
          activity={activity}
          onOpenAssistant={assistant.open}
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
