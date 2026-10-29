import type { Language } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { Linking, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { api } from '@/lib/api';
import { supportMessage, supportWhatsappUrl } from '@/lib/contact';
import { useEmployees, useLoyaltyProgram, useSubscription } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useDialogs } from '@/ui/Dialogs';
import { Card, Chip, Row, SectionTitle, ToggleRow } from '@/ui/Kit';
import { NotificationsSection } from '@/ui/NotificationsSection';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';


export default function More() {
  const router = useRouter();
  const { t, language, setLanguage, theme, setTheme, aiFab, setAiFab, whatsappFab, setWhatsappFab, colors } = useSettings();
  // Borde dorado fino (el dorado de la app con ~45% de opacidad) en los grupos de esta pantalla.
  const goldBorder = { borderColor: `${colors.gold}73` };
  const { user, business, signOut } = useSession();
  const { confirm } = useDialogs();
  const { data: subscription } = useSubscription();
  const actor = actorOf(user);
  const isOwner = user?.role !== 'employee';
  const employees = useEmployees(isOwner);
  const activeEmployees = employees.data?.filter((e) => e.active).length;
  const employeeCount = activeEmployees === undefined ? undefined : activeEmployees === 1 ? t('emp_count_one') : t('emp_count_other', { n: activeEmployees });
  const canLoyalty = meets(actor, ['loyalty_redeem', 'services_record']);
  const loyalty = useLoyaltyProgram(canLoyalty);
  const loyaltyLabel = loyalty.data ? (loyalty.data.enabled ? t('loyalty_status_on') : t('loyalty_status_off')) : undefined;
  const planLabel = subscription?.plan === 'yearly' ? t('plan_yearly') : subscription?.plan === 'monthly' ? t('plan_monthly') : undefined;

  /* Preferencias: se aplican al instante y se guardan en la cuenta (sin bloquear la UI si falla la red). */
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

  return (
    <Screen header={<Header root title={t('more')} />}>
      <Card style={goldBorder}>
        <Row icon="person-outline" label={user?.name ?? ''} value={`${t('account')} · ${business?.name ?? ''}`} onPress={() => router.push('/profile')} />
        {isOwner ? <Row icon="storefront-outline" label={t('business_settings')} onPress={() => router.push('/business')} /> : null}
        {meets(actor, ['catalog_manage']) ? <Row icon="pricetags-outline" label={t('manage_categories')} onPress={() => router.push('/categories')} /> : null}
        {isOwner ? <Row icon="star-outline" label={t('subscription_title')} value={planLabel} onPress={() => router.push('/subscription')} /> : null}
        {canLoyalty ? <Row icon="gift-outline" label={t('loyalty_title')} value={loyaltyLabel} onPress={() => router.push('/loyalty')} /> : null}
        {isOwner ? <Row icon="people-circle-outline" label={t('team')} value={employeeCount} onPress={() => router.push('/employees')} /> : null}
      </Card>

      <SectionTitle>{t('preferences')}</SectionTitle>
      <Card style={goldBorder}>
        <View style={{ paddingVertical: 6 }}>
          <AppText variant="bodyStrong" style={{ marginBottom: 10 }}>
            {t('language')}
          </AppText>
          <View style={{ flexDirection: 'row', gap: 8 }} role="radiogroup" aria-label={t('language')}>
            <Chip label={t('language_es')} selected={language === 'es'} onPress={() => changeLanguage('es')} />
            <Chip label={t('language_en')} selected={language === 'en'} onPress={() => changeLanguage('en')} />
          </View>
        </View>
        <ToggleRow icon="moon-outline" label={t('dark_mode')} value={theme === 'dark'} onChange={changeTheme} />
        {/* Preferencia de este dispositivo: el botón aparece o desaparece de Inicio al instante y se recuerda al reabrir. */}
        <ToggleRow icon="sparkles-outline" label={t('ai_show_fab')} value={aiFab} onChange={setAiFab} />
        {/* Hoy el botón flotante de WhatsApp solo existe en la web; la preferencia ya queda lista para cuando lo haya en la app. */}
        <ToggleRow icon="logo-whatsapp" label={t('whatsapp_show_fab')} value={whatsappFab} onChange={setWhatsappFab} />
      </Card>

      {isOwner ? <NotificationsSection /> : null}

      <SectionTitle>{t('account')}</SectionTitle>
      <Card style={goldBorder}>
        {/* Mismo contacto oficial que la web y el menú lateral (lib/contact), con el mensaje en el idioma de la persona. */}
        <Row icon="logo-whatsapp" label={t('support_whatsapp')} onPress={() => void Linking.openURL(supportWhatsappUrl(supportMessage(language, business?.name))).catch(() => undefined)} />
        <Row icon="log-out-outline" label={t('logout')} value={t('logout_sub')} tone="danger" onPress={logout} />
      </Card>
    </Screen>
  );
}
