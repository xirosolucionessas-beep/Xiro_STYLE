import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { errorKey } from '@/lib/api';
import { useBookingSettings } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button, Chip, ChipRow, PANEL_SCOPE } from './PanelKit';
import { Header, Screen } from '../Screen';
import { AppText } from '../Text';
import { InfoTab } from './InfoTab';
import { LinkTab } from './LinkTab';
import { DiscountsTab } from './DiscountsTab';
import { ReviewsTab } from './ReviewsTab';
import { WaitlistTab } from './WaitlistTab';
import { RulesTab } from './RulesTab';
import { TeamTab } from './TeamTab';

const TABS = ['link', 'info', 'rules', 'team', 'reviews', 'promos', 'waitlist'] as const;
type Tab = (typeof TABS)[number];

/**
 * "Mi página web": todo lo que el negocio configura para que sus clientes reserven en línea (enlace, presentación, reglas
 * de agenda, equipo y reseñas). Quién puede entrar lo decide el permiso "gestionar la página pública".
 */
export function BookingPanel() {
  const { t } = useSettings();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(params.tab ?? '') ? (params.tab as Tab) : 'link');
  const settings = useBookingSettings();

  return (
    <Screen header={<Header title={t('booking_title')} subtitle={t('booking_subtitle')} />} refreshing={settings.isRefetching} onRefresh={() => void settings.refetch()}>
      <View {...PANEL_SCOPE}>
      <ChipRow label={t('booking_title')}>
        {TABS.map((id) => (
          <Chip key={id} label={t(`booking_tab_${id}`)} selected={tab === id} onPress={() => setTab(id)} />
        ))}
      </ChipRow>
      <View style={{ marginTop: 8 }}>
        {settings.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('loading')} /> : null}
        {settings.isError ? (
          <View style={{ gap: 8, marginTop: 16 }}>
            <AppText tone="danger" accessibilityLiveRegion="polite">
              {t(errorKey(settings.error))}
            </AppText>
            <Button label={t('retry')} variant="secondary" compact onPress={() => void settings.refetch()} style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : null}
        {settings.data && tab === 'link' ? <LinkTab data={settings.data} onGoTab={setTab} /> : null}
        {settings.data && tab === 'info' ? <InfoTab data={settings.data} /> : null}
        {settings.data && tab === 'rules' ? <RulesTab data={settings.data} /> : null}
        {tab === 'team' ? <TeamTab /> : null}
        {tab === 'reviews' ? <ReviewsTab /> : null}
        {settings.data && tab === 'promos' ? <DiscountsTab data={settings.data} onGoTab={setTab} /> : null}
        {settings.data && tab === 'waitlist' ? <WaitlistTab data={settings.data} onGoTab={setTab} /> : null}
      </View>
      </View>
    </Screen>
  );
}
