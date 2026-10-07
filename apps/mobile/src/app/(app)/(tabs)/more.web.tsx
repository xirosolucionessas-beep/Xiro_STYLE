/**
 * Ruta /more (Ajustes) SOLO WEB (nativo: more.tsx, sin cambios). Mismas opciones y reglas de permisos que la nativa;
 * la presentación está en src/web/screens/Settings.tsx.
 */
import { useQueryClient } from '@tanstack/react-query';
import type { Language, NotificationSettings } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { actorOf, meets } from '@/lib/access';
import { api, errorKey } from '@/lib/api';
import { supportMessage, supportWhatsappUrl } from '@/lib/contact';
import { turnOff, turnOn } from '@/lib/notifications';
import { push } from '@/lib/push';
import type { PushPermission } from '@/lib/pushTypes';
import { keys, useEmployees, useLoyaltyProgram, useNotificationSettings, useSubscription } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useDialogs } from '@/ui/Dialogs';
import { Header, Screen } from '@/ui/Screen';
import { SettingsView, type NotificationsModel, type SettingsLink } from '@/web/screens/Settings';
import { useWebText } from '@/web/services/useWebText';

const DEFAULTS: NotificationSettings = {
  enabled: false,
  loyaltyEnabled: true,
  billingEnabled: true,
  appointmentsEnabled: true,
  reviewsEnabled: true,
  clientsEnabled: true,
  salesEnabled: true,
  inventoryEnabled: true,
  employeesEnabled: true,
  securityEnabled: true,
};

/** Notificaciones del negocio (mismo flujo que la sección nativa: explicar → pedir permiso → registrar → guardar). */
function useNotificationsModel(enabled: boolean, t: (key: string) => string): NotificationsModel | null {
  const { toast, confirm } = useDialogs();
  const queryClient = useQueryClient();
  const { data } = useNotificationSettings();
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PushPermission>('undetermined');
  const settings = data ?? DEFAULTS;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void push.permission().then((value) => active && setPermission(value));
    return () => {
      active = false;
    };
  }, [enabled, settings.enabled]);

  if (!enabled) return null;

  const save = async (next: NotificationSettings) => {
    const saved = await api.updateNotificationSettings(next);
    queryClient.setQueryData(keys.notificationSettings, saved);
    return saved;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  };

  return {
    enabled: settings.enabled,
    loyalty: settings.loyaltyEnabled,
    billing: settings.billingEnabled,
    appointments: settings.appointmentsEnabled,
    reviews: settings.reviewsEnabled,
    clients: settings.clientsEnabled,
    sales: settings.salesEnabled,
    inventory: settings.inventoryEnabled,
    employees: settings.employeesEnabled,
    security: settings.securityEnabled,
    busy,
    note: permission === 'denied' ? t('sec_set_notifs_blocked') : permission === 'unavailable' ? t('sec_set_notifs_unsupported') : undefined,
    onToggle: (next) =>
      void run(async () => {
        const deps = { push, current: settings, save };
        const result = next ? await turnOn({ ...deps, confirmRationale: () => confirm({ title: t('notifications'), message: t('notifications_enable_hint'), confirmLabel: t('notifications_enable_cta') }) }) : await turnOff(deps);
        if (!result.ok && result.messageKey) toast(t(result.messageKey));
      }),
    onLoyalty: (next) => void run(async () => void (await save({ ...settings, loyaltyEnabled: next }))),
    onBilling: (next) => void run(async () => void (await save({ ...settings, billingEnabled: next }))),
    onAppointments: (next) => void run(async () => void (await save({ ...settings, appointmentsEnabled: next }))),
    onReviews: (next) => void run(async () => void (await save({ ...settings, reviewsEnabled: next }))),
    onClients: (next) => void run(async () => void (await save({ ...settings, clientsEnabled: next }))),
    onSales: (next) => void run(async () => void (await save({ ...settings, salesEnabled: next }))),
    onInventory: (next) => void run(async () => void (await save({ ...settings, inventoryEnabled: next }))),
    onEmployees: (next) => void run(async () => void (await save({ ...settings, employeesEnabled: next }))),
    onSecurity: (next) => void run(async () => void (await save({ ...settings, securityEnabled: next }))),
    onTest: () =>
      void run(async () => {
        const { sent } = await api.sendTestNotification();
        toast(t(sent > 0 ? 'notifications_test_sent' : 'notifications_test_failed'));
      }),
  };
}

export default function MoreWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { setLanguage, theme, setTheme, aiFab, setAiFab } = useSettings();
  const { user, business, signOut } = useSession();
  const { confirm } = useDialogs();
  const subscription = useSubscription();
  const actor = actorOf(user);
  const isOwner = user?.role !== 'employee';
  const employees = useEmployees(isOwner);
  const canLoyalty = meets(actor, ['loyalty_redeem', 'services_record']);
  const loyalty = useLoyaltyProgram(canLoyalty);
  const notifications = useNotificationsModel(isOwner, t);

  const activeEmployees = employees.data?.filter((e) => e.active).length;
  const teamSub = activeEmployees === undefined ? undefined : activeEmployees === 1 ? t('emp_count_one') : t('emp_count_other', { n: activeEmployees });
  const planSub = subscription.data?.plan === 'yearly' ? t('plan_yearly') : subscription.data?.plan === 'monthly' ? t('plan_monthly') : undefined;
  const loyaltySub = loyalty.data ? (loyalty.data.enabled ? t('loyalty_status_on') : t('loyalty_status_off')) : undefined;

  const accountLinks = useMemo<SettingsLink[]>(
    () => [
      { id: 'profile', icon: 'user', title: user?.name ?? '', sub: `${t('account')} · ${business?.name ?? ''}`, href: '/profile' },
      ...(isOwner ? [{ id: 'business', icon: 'store' as const, title: t('business_settings'), href: '/business' }] : []),
      ...(meets(actor, ['catalog_manage']) ? [{ id: 'categories', icon: 'tag' as const, title: t('manage_categories'), href: '/categories' }] : []),
      ...(isOwner ? [{ id: 'plan', icon: 'crown' as const, title: t('subscription_title'), sub: planSub, href: '/subscription' }] : []),
      ...(canLoyalty ? [{ id: 'loyalty', icon: 'gift' as const, title: t('loyalty_title'), sub: loyaltySub, href: '/loyalty' }] : []),
      ...(isOwner ? [{ id: 'team', icon: 'briefcase' as const, title: t('team'), sub: teamSub, href: '/employees' }] : []),
    ],
    [user?.name, business?.name, isOwner, actor, canLoyalty, planSub, loyaltySub, teamSub, t],
  );

  const changeLanguage = (next: Language) => {
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

  const supportLinks: SettingsLink[] = [
    { id: 'support', icon: 'message-circle', title: t('support_whatsapp'), sub: t('sec_set_support_desc'), onPress: () => window.open(supportWhatsappUrl(supportMessage(language, business?.name)), '_blank', 'noopener,noreferrer') },
    { id: 'logout', icon: 'log-out', title: t('logout'), sub: t('logout_sub'), tone: 'danger', onPress: () => void logout() },
  ];

  return (
    <Screen header={<Header root title={t('nav_settings')} subtitle={t('sec_settings_sub')} />}>
      <SettingsView
        t={t}
        accountLinks={accountLinks}
        language={language}
        onLanguage={changeLanguage}
        darkMode={theme === 'dark'}
        onDarkMode={changeTheme}
        aiFab={aiFab}
        onAiFab={setAiFab}
        notifications={notifications}
        supportLinks={supportLinks}
        navigate={(href) => router.push(href as never)}
      />
    </Screen>
  );
}
