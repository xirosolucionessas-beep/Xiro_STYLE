import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, type Currency } from '@xiro/shared';
import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { dayRange, localDate, todayIn, upcoming } from '@/lib/agenda';
import { relativeTime } from '@/lib/alerts';
import { api } from '@/lib/api';
import { buildActivity, daySummary, lowStockList } from '@/lib/dashboard';
import { formatCompactMoney, lowStock, salesToday, TEAM_LABEL_KEYS } from '@/lib/homeMetrics';
import { menuFor } from '@/lib/menu';
import { keys, useAppointments, useCashToday, useClassification, useClients, useEmployees, useItems, useServiceRecords } from '@/lib/queries';
import { useAuthed, useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useGreetingKey } from '@/lib/useGreeting';
import { useCookieConsent } from '@/lib/useCookieConsent';
import { useHomeAlerts } from '@/lib/useHomeAlerts';
import { useDialogs } from '@/ui/Dialogs';
import { AlertsCard } from '@/ui/home/AlertsCard';
import { AssistantChat } from '@/ui/home/AssistantChat';
import { ActivityCard, DaySummaryCard, StockAlertsCard, type ActivityRow, type SummaryStat } from '@/ui/home/DashboardCards';
import { HomeHeader } from '@/ui/home/HomeHeader';
import { MetricCards, type Metric } from '@/ui/home/MetricCards';
import { FabSecondary, QuickAddFab, type FabAction } from '@/ui/home/QuickAddFab';
import { SideMenu } from '@/ui/home/SideMenu';
import { UpcomingList } from '@/ui/home/UpcomingList';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

let cashPromptShown = false;

type IconName = keyof typeof Ionicons.glyphMap;
const TAB_ROUTES = new Set(['/', '/clients', '/catalog', '/inventory', '/more']);

/**
 * Inicio nativo. Es solo presentación y navegación: usa las consultas y pantallas que ya existen (caja, ventas, clientes,
 * inventario, citas, equipo) y no inventa datos. Arriba, la fila de indicadores del día (citas, ventas, clientes y equipo,
 * cada uno lleva a su sección); debajo, los paneles Resumen del día (con la base de caja), Alertas de inventario y
 * Actividad reciente, calculados con las mismas funciones que el tablero web.
 * Todas las secciones siguen en el menú lateral; el "+" registra una venta (y conserva nuevo servicio y nuevo cliente).
 */
export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { colors, t, language, setLanguage, theme, setTheme, aiFab } = useSettings();
  const { user, business } = useAuthed();
  const { signOut } = useSession();
  const { toast, confirm } = useDialogs();
  const greeting = useGreetingKey();
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const actor = actorOf(user);
  const isOwner = user.role === 'owner';
  const canClients = meets(actor, ['clients_view']);
  const canCatalog = meets(actor, ['catalog_view']);
  const canSales = meets(actor, ['services_record']);

  const cash = useCashToday(isOwner);
  const clients = useClients('', canClients);
  const items = useItems(canCatalog);
  const records = useServiceRecords(undefined, canSales);
  const employees = useEmployees(isOwner);
  const canAgenda = meets(actor, ['agenda_own']);
  const canReview = meets(actor, ['catalog_manage']);
  const today = todayIn(business.timezone);
  const week = useMemo(() => dayRange(today, business.timezone, 7), [today, business.timezone]);
  const appointments = useAppointments(week, canAgenda);
  const classification = useClassification(canReview);
  const { pending, loading: alertsLoading, read } = useHomeAlerts();
  const cookies = useCookieConsent();

  // La foto del negocio lleva degradado oscuro: los iconos de la barra de estado deben verse claros sobre ella.
  const photo = Boolean(business.logoUrl);
  useFocusEffect(
    useCallback(() => {
      if (photo) setStatusBarStyle('light');
      return () => setStatusBarStyle(theme === 'dark' ? 'light' : 'dark');
    }, [photo, theme]),
  );

  // Comportamiento previo: la primera vez que el dueño abre la app sin caja del día, se le ofrece abrirla.
  useEffect(() => {
    // Primero el aviso de cookies del primer ingreso; la petición de abrir la caja espera a que se acepte.
    if (isOwner && cash.isSuccess && !cash.data.opening && !cashPromptShown && !cookies.visible) {
      cashPromptShown = true;
      router.push('/cash-opening');
    }
  }, [isOwner, cash.isSuccess, cash.data, cookies.visible, router]);

  const go = (href: string) => (TAB_ROUTES.has(href.split('?')[0]!) ? router.navigate(href) : router.push(href));
  const soon = () => toast(`${t('coming_soon')} · ${t('menu_soon_notice')}`);
  const money = (amount: number) => formatMoney(amount, business.currency as Currency);
  const opening = cash.data?.opening;

  /* ---------- Paneles del día (mismas funciones que el tablero web) ---------- */
  const dashboard = useMemo(() => {
    const now = new Date();
    return {
      summary: records.data ? daySummary(records.data, business.timezone, now) : null,
      lowStock: items.data ? lowStockList(items.data, 4) : [],
      stockCounts: items.data ? lowStock(items.data) : null,
      activity: buildActivity({ records: records.data, clients: clients.data, items: items.data, limit: 6 }),
    };
  }, [records.data, clients.data, items.data, business.timezone]);

  // Citas de HOY: las concretadas (completadas) frente a las que siguen en pie (sin canceladas ni inasistencias).
  const todayAppointments = canAgenda && appointments.data ? appointments.data.filter((a) => localDate(a.startsAt, business.timezone) === today && a.status !== 'cancelled' && a.status !== 'no_show') : null;
  const completedToday = todayAppointments?.filter((a) => a.status === 'completed').length;

  /* ---------- Fila de indicadores: lo que no puede ver por su rol se muestra "—" (y la tarjeta no navega) ---------- */
  const activeEmployees = employees.data?.filter((employee) => employee.active).length;
  const metrics: Metric[] = [
    { id: 'appointments', icon: 'calendar-outline', value: todayAppointments ? String(todayAppointments.length) : '—', label: t('metric_appointments'), loading: canAgenda && appointments.isLoading, onPress: canAgenda ? () => go('/agenda') : undefined },
    { id: 'sales', icon: 'cash-outline', value: canSales && records.data ? formatCompactMoney(salesToday(records.data, business.timezone), business.currency as Currency) : '—', label: t('metric_sales'), loading: canSales && records.isLoading, onPress: canSales ? () => go('/sales-today') : undefined },
    { id: 'clients', icon: 'people-outline', value: canClients && clients.data ? String(clients.data.length) : '—', label: t('metric_clients'), loading: canClients && clients.isLoading, onPress: canClients ? () => go('/clients') : undefined },
    { id: 'team', icon: 'cut-outline', value: activeEmployees !== undefined ? String(activeEmployees) : '—', label: t(TEAM_LABEL_KEYS[business.type]), loading: isOwner && employees.isLoading, onPress: isOwner ? () => go('/employees') : undefined },
  ];

  const summary = dashboard.summary;
  const summaryStats: SummaryStat[] = [
    { id: 'sales', label: t('home_summary_sales'), value: summary ? String(summary.count) : '—' },
    { id: 'average', label: t('home_summary_average'), value: summary?.average != null ? money(summary.average) : '—' },
    ...(canAgenda
      ? [{ id: 'appointments', label: t('home_summary_appointments'), value: todayAppointments ? t('home_summary_appointments_of', { done: completedToday ?? 0, total: todayAppointments.length }) : '—' }]
      : []),
  ];

  const stockRows = dashboard.lowStock.map((item) => ({
    id: item.id,
    name: item.name,
    out: item.stockStatus === 'out_of_stock',
    badge: item.stockStatus === 'out_of_stock' ? t('home_stock_out') : t('home_stock_units', { n: item.stock }),
    onPress: () => router.push(`/item/${item.id}`),
  }));

  const nowMs = Date.now();
  const activityRows: ActivityRow[] = dashboard.activity.map((event) => ({
    id: event.id,
    icon: event.kind === 'service' ? 'cut-outline' : event.kind === 'client' ? 'person-add-outline' : 'cube-outline',
    title: event.kind === 'service' ? t('home_activity_service', { name: event.primary }) : event.primary,
    detail: event.kind === 'service' ? event.secondary : event.kind === 'client' ? t('home_activity_client') : `${t('home_activity_stock')} · ${t('home_stock_units', { n: event.units ?? 0 })}`,
    time: relativeTime(event.at, nowMs, language),
    amount: event.amount !== undefined ? money(event.amount) : undefined,
  }));
  const activityLoading = (canSales && records.isLoading) || (canClients && clients.isLoading) || (canCatalog && items.isLoading);

  /* ---------- Botón "+": Registrar venta es la acción principal; nuevo servicio y nuevo cliente se conservan ---------- */
  const fabActions: FabAction[] = [
    ...(canSales ? [{ id: 'sale', label: t('home_fab_sale'), icon: 'cash-outline' as IconName, onPress: () => router.push('/sale/new'), primary: true }] : []),
    ...(meets(actor, ['catalog_manage']) ? [{ id: 'service', label: t('home_fab_service'), icon: 'add-circle-outline' as IconName, onPress: () => router.push('/item/form') }] : []),
    ...(meets(actor, ['clients_manage']) ? [{ id: 'client', label: t('home_fab_client'), icon: 'person-add-outline' as IconName, onPress: () => router.push('/client/form') }] : []),
  ];

  const refresh = () => Promise.all([keys.cash, keys.clients, keys.items, keys.employees, keys.serviceRecords, keys.subscription, keys.appointments, keys.classification].map((queryKey) => queryClient.invalidateQueries({ queryKey })));

  const changeLanguage = (next: 'es' | 'en') => {
    setLanguage(next);
    void api.updateMe({ language: next }).catch(() => undefined);
  };
  const changeTheme = (dark: boolean) => {
    const next = dark ? 'dark' : 'light';
    setTheme(next);
    void api.updateMe({ theme: next }).catch(() => undefined);
  };
  const logout = async () => {
    if (await confirm({ title: t('logout'), message: t('logout_sub'), confirmLabel: t('logout'), destructive: true })) await signOut();
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={cash.isRefetching} onRefresh={() => void refresh()} tintColor={colors.gold} />}>
        <HomeHeader
          businessName={business.name.trim() || user.name}
          photoUrl={business.logoUrl}
          greeting={t(greeting)}
          tagline={t('home_tagline')}
          pendingAlerts={pending.length}
          onMenu={() => setMenuOpen(true)}
          onBell={() => router.push('/notifications')}
        />

        <View style={styles.body}>
          <MetricCards metrics={metrics} />

          {canSales || isOwner ? (
            <DaySummaryCard
              title={t('home_summary_title')}
              revenueLabel={t('home_summary_revenue')}
              revenue={canSales ? (summary ? money(summary.total) : '—') : '—'}
              stats={summaryStats}
              note={summary?.topLabel ? t('home_summary_top', { name: summary.topLabel }) : undefined}
              loading={canSales && records.isLoading}
              seeAll={canSales ? { label: t('home_see_all'), onPress: () => router.push('/sales-today') } : undefined}
              cash={
                isOwner
                  ? {
                      label: t('available_balance'),
                      value: opening ? money(opening.amount) : '—',
                      note: !opening && cash.isSuccess ? t('cash_not_opened') : undefined,
                      onPress: () => router.push('/cash-opening'),
                    }
                  : undefined
              }
            />
          ) : null}

          {canReview && classification.data && classification.data.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('review_banner', { count: classification.data.length })}
              onPress={() => router.push('/review-items')}
              style={[styles.review, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
              <Ionicons name="checkmark-done-outline" size={24} color={colors.gold} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{t('review_banner', { count: classification.data.length })}</AppText>
                <AppText tone="muted" variant="small">
                  {t('review_banner_hint')}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.gold} />
            </Pressable>
          ) : null}

          {canCatalog ? (
            <StockAlertsCard
              title={t('home_stock_title')}
              rows={stockRows}
              loading={items.isLoading}
              emptyText={t('home_stock_all_good')}
              seeAll={{ label: t('home_stock_see_all'), onPress: () => go(`/inventory?status=${dashboard.stockCounts && dashboard.stockCounts.outOfStock > 0 ? 'out_of_stock' : 'reorder'}`) }}
            />
          ) : null}

          {canAgenda ? (
            <>
              <View style={styles.sectionHead}>
                <AppText variant="heading" accessibilityRole="header">
                  {t('home_upcoming')}
                </AppText>
                <Pressable accessibilityRole="button" onPress={() => go('/agenda')} hitSlop={10} style={styles.seeAll}>
                  <AppText tone="gold" variant="bodyStrong">
                    {t('home_see_all')} ›
                  </AppText>
                </Pressable>
              </View>
              <UpcomingList appointments={upcoming(appointments.data ?? [], new Date(), 3)} timezone={business.timezone} loading={appointments.isLoading} onOpen={() => go('/agenda')} />
            </>
          ) : null}

          {canSales || canClients || canCatalog ? <ActivityCard title={t('home_activity_title')} rows={activityRows} loading={activityLoading} emptyText={t('home_activity_empty')} /> : null}

          <AlertsCard
            alerts={pending}
            loading={alertsLoading}
            onOpen={(alert) => {
              read(alert);
              go(alert.href);
            }}
          />
        </View>
      </ScrollView>

      <QuickAddFab actions={fabActions} label={t('home_fab_label')} above={aiFab ? <FabSecondary icon="sparkles" label={t('ai_fab_label')} onPress={() => setAssistantOpen(true)} /> : undefined} />

      <AssistantChat open={assistantOpen} onClose={() => setAssistantOpen(false)} />

      <SideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        sections={menuFor(actor)}
        pathname={pathname}
        business={{ name: business.name, type: business.type, logoUrl: business.logoUrl }}
        user={{ name: user.name, role: user.role, photoUrl: user.photoUrl }}
        badges={{ inventory: items.data ? lowStock(items.data).count : undefined }}
        language={language}
        dark={theme === 'dark'}
        onLanguage={changeLanguage}
        onDark={changeTheme}
        onNavigate={go}
        onSoon={soon}
        onAssistant={() => setAssistantOpen(true)}
        onAccount={() => router.push('/profile')}
        onNotifications={() => router.push('/notifications')}
        onLogout={() => void logout()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 170 },
  body: { paddingHorizontal: 16, marginTop: -6, gap: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  seeAll: { minHeight: 44, justifyContent: 'center' },
  review: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.lg, padding: 14 },
});
