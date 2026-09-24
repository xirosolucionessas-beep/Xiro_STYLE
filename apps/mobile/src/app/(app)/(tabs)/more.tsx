import { whatsappLink, type Language } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { Linking, Platform, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { api } from '@/lib/api';
import { useSubscription } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useDialogs } from '@/ui/Dialogs';
import { Card, Chip, Row, SectionTitle, ToggleRow } from '@/ui/Kit';
import { NotificationsSection } from '@/ui/NotificationsSection';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';


const SUPPORT_WHATSAPP = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP;

export default function More() {
  const router = useRouter();
  const { t, language, setLanguage, theme, setTheme } = useSettings();
  const { user, business, signOut } = useSession();
  const { toast, confirm } = useDialogs();
  const { data: subscription } = useSubscription();
  const actor = actorOf(user);
  const isOwner = user?.role !== 'employee';
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
      <Card>
        <Row icon="person-outline" label={user?.name ?? ''} value={`${t('account')} · ${business?.name ?? ''}`} onPress={() => router.push('/profile')} />
        {isOwner ? <Row icon="storefront-outline" label={t('business_settings')} onPress={() => router.push('/business')} /> : null}
        {meets(actor, ['catalog_manage']) ? <Row icon="pricetags-outline" label={t('manage_categories')} onPress={() => router.push('/categories')} /> : null}
        {isOwner ? <Row icon="star-outline" label={t('subscription_title')} value={planLabel} onPress={() => router.push('/subscription')} /> : null}
        {isOwner ? (
          Platform.OS === 'web' ? (
            <Row icon="people-circle-outline" label={t('team')} onPress={() => router.push('/employees')} />
          ) : (
            <Row icon="people-circle-outline" label={t('team')} value={t('coming_soon')} onPress={() => toast(`${t('coming_soon')} · ${t('coming_soon_body')}`)} />
          )
        ) : null}
      </Card>

      <SectionTitle>{t('preferences')}</SectionTitle>
      <Card>
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
      </Card>

      {isOwner ? <NotificationsSection /> : null}

      <SectionTitle>{t('account')}</SectionTitle>
      <Card>
        {SUPPORT_WHATSAPP ? (
          <Row icon="logo-whatsapp" label={t('support_whatsapp')} onPress={() => void Linking.openURL(whatsappLink(SUPPORT_WHATSAPP, 'Hola, necesito ayuda con Xiro Style.'))} />
        ) : null}
        <Row icon="log-out-outline" label={t('logout')} value={t('logout_sub')} tone="danger" onPress={logout} />
      </Card>
    </Screen>
  );
}
