import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, type Currency } from '@xiro/shared';
import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { actorOf, meets, type Requirement } from '@/lib/access';
import { dayRange, localDate, todayIn, upcoming } from '@/lib/agenda';
import { api } from '@/lib/api';
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
import { GradientCard } from '@/ui/home/GradientCard';
import { HomeHeader } from '@/ui/home/HomeHeader';
import { MetricCards, type Metric } from '@/ui/home/MetricCards';
import { QuickAddFab, type FabAction } from '@/ui/home/QuickAddFab';
import { SideMenu } from '@/ui/home/SideMenu';
import { UpcomingList } from '@/ui/home/UpcomingList';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

let cashPromptShown = false;

type IconName = keyof typeof Ionicons.glyphMap;
const TAB_ROUTES = new Set(['/', '/clients', '/catalog', '/inventory', '/more']);

/**
 * Inicio nativo. Es solo presentación y navegación: usa las consultas y pantallas que ya existen (caja, clientes,
 * inventario, servicios registrados, empleados, suscripción) y no inventa datos. Lo que depende de un módulo que aún no
 * existe (Citas) muestra "—" y "Próximamente"; lo que la persona no puede ver por su rol también muestra "—".
 */
export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { colors, t, language, setLanguage, theme, setTheme } = useSettings();
  const { user, business } = useAuthed();
  const { signOut } = useSession();
  const { toast, confirm } = useDialogs();
  const { width } = useWindowDimensions();
  const greeting = useGreetingKey();
  const [menuOpen, setMenuOpen] = useState(false);

  const actor = actorOf(user);
  const isOwner = user.role === 'owner';
  const canClients = meets(actor, ['clients_view']);
  const canCatalog = meets(actor, ['catalog_view']);
  const canSales = meets(actor, ['services_record']);

  const cash = useCashToday(isOwner);
  const clients = useClients('', canClients);
  const items = useItems(canCatalog);
  const employees = useEmployees(isOwner);
  const records = useServiceRecords(undefined, canSales);
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
  const opening = cash.data?.opening;

  /* ---------- Indicadores del día ---------- */
  const activeEmployees = employees.data?.filter((employee) => employee.active).length;
  const metrics: Metric[] = [
    {
      id: 'appointments',
      icon: 'calendar-outline',
      value: canAgenda && appointments.data ? String(appointments.data.filter((a) => localDate(a.startsAt, business.timezone) === today && a.status !== 'cancelled' && a.status !== 'no_show').length) : '—',
      label: t('metric_appointments'),
      loading: canAgenda && appointments.isLoading,
      onPress: canAgenda ? () => go('/agenda') : undefined,
    },
    {
      id: 'sales',
      icon: 'cash-outline',
      value: canSales && records.data ? formatCompactMoney(salesToday(records.data, business.timezone), business.currency as Currency) : '—',
      label: t('metric_sales'),
      loading: canSales && records.isLoading,
      onPress: canSales ? () => go('/sales-today') : undefined,
    },
    { id: 'clients', icon: 'people-outline', value: canClients && clients.data ? String(clients.data.length) : '—', label: t('metric_clients'), loading: canClients && clients.isLoading, onPress: canClients ? () => go('/clients') : undefined },
    { id: 'team', icon: 'cut-outline', value: activeEmployees !== undefined ? String(activeEmployees) : '—', label: t(TEAM_LABEL_KEYS[business.type]), loading: isOwner && employees.isLoading, onPress: isOwner ? () => go('/employees') : undefined },
  ];

  /* ---------- Accesos rápidos: los de siempre (mismo destino) + Equipo y Fidelización ---------- */
  const shortcuts: Array<{ id: string; icon: IconName; label: string; onPress: () => void; requires?: Requirement }> = [
    { id: 'new_sale', icon: 'cash-outline', label: t('new_sale'), onPress: () => router.push('/sale/new'), requires: ['services_record'] },
    { id: 'appointments', icon: 'calendar-outline', label: t('appointments'), onPress: () => router.push('/agenda'), requires: ['agenda_own'] },
    { id: 'catalog', icon: 'book-outline', label: t('catalog'), onPress: () => router.navigate('/catalog'), requires: ['catalog_view'] },
    { id: 'inventory', icon: 'cube-outline', label: t('inventory'), onPress: () => router.navigate('/inventory'), requires: ['catalog_view'] },
    { id: 'cash_close', icon: 'wallet-outline', label: t('cash_close'), onPress: () => router.push('/cash-close'), requires: 'owner' },
    { id: 'clients', icon: 'people-outline', label: t('clients'), onPress: () => router.navigate('/clients'), requires: ['clients_view'] },
    { id: 'team', icon: 'people-circle-outline', label: t('team'), onPress: () => router.push('/employees'), requires: 'owner' },
    { id: 'loyalty', icon: 'gift-outline', label: t('loyalty_title'), onPress: () => router.push('/loyalty'), requires: ['loyalty_redeem', 'services_record'] },
  ];
  const visibleShortcuts = shortcuts.filter((shortcut) => meets(actor, shortcut.requires));
  const columns = width >= 600 ? 3 : 2;

  const fabActions: FabAction[] = [
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
          slogan={t('home_brand_slogan')}
          pendingAlerts={pending.length}
          onMenu={() => setMenuOpen(true)}
          onBell={() => router.push('/notifications')}
        />

        <View style={styles.body}>
          <MetricCards metrics={metrics} />

          {isOwner ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('available_balance')}: ${opening ? formatMoney(opening.amount, business.currency) : t('cash_not_opened')}`}
              onPress={() => router.push('/cash-opening')}
              style={[styles.balance, { backgroundColor: colors.surfaceAlt, borderColor: colors.gold }]}>
              <View style={[styles.wallet, { backgroundColor: colors.goldTint }]}>
                <Ionicons name="wallet-outline" size={26} color={colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText tone="muted" variant="small">
                  {t('available_balance')}
                </AppText>
                <AppText variant="display">{opening ? formatMoney(opening.amount, business.currency) : '—'}</AppText>
                {!opening && cash.isSuccess ? (
                  <AppText variant="small" tone="gold">
                    {t('cash_not_opened')}
                  </AppText>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.gold} />
            </Pressable>
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

          <AlertsCard
            alerts={pending}
            loading={alertsLoading}
            onOpen={(alert) => {
              read(alert);
              go(alert.href);
            }}
          />

          <AppText variant="heading" accessibilityRole="header" style={styles.quickTitle}>
            {t('home_quick_access')}
          </AppText>
          <View style={styles.grid}>
            {visibleShortcuts.map((shortcut) => (
              <GradientCard key={shortcut.id} onPress={shortcut.onPress} accessibilityLabel={shortcut.label} style={{ width: `${100 / columns - 2.5}%` }} innerStyle={styles.tile}>
                <View style={[styles.tileIcon, { backgroundColor: colors.goldTint }]}>
                  <Ionicons name={shortcut.icon} size={24} color={colors.gold} />
                </View>
                <AppText variant="bodyStrong" style={{ marginTop: 12 }}>
                  {shortcut.label}
                </AppText>
              </GradientCard>
            ))}
          </View>
        </View>
      </ScrollView>

      <QuickAddFab actions={fabActions} label={t('home_fab_label')} />

      <SideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        sections={menuFor(actor)}
        pathname={pathname}
        business={{ name: business.name, type: business.type, logoUrl: business.logoUrl }}
        user={{ name: user.name, role: user.role }}
        badges={{ inventory: items.data ? lowStock(items.data).count : undefined }}
        language={language}
        dark={theme === 'dark'}
        onLanguage={changeLanguage}
        onDark={changeTheme}
        onNavigate={go}
        onSoon={soon}
        onAccount={() => router.push('/profile')}
        onNotifications={() => router.push('/notifications')}
        onLogout={() => void logout()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 150 },
  body: { paddingHorizontal: 16, marginTop: -6, gap: 14 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: radius.xl, borderWidth: 1, padding: 16 },
  wallet: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  seeAll: { minHeight: 44, justifyContent: 'center' },
  review: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.lg, padding: 14 },
  quickTitle: { marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  tile: { minHeight: 122, padding: 14, justifyContent: 'space-between' },
  tileIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
