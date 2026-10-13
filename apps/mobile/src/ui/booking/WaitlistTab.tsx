import { useQueryClient } from '@tanstack/react-query';
import { whatsappLink, type BookingAdminSettings, type WaitlistEntryDto } from '@xiro/shared';
import { ActivityIndicator, Linking, View } from 'react-native';
import { formatDay, upperFirst } from '@/lib/agenda';
import { api, errorKey } from '@/lib/api';
import { keys, useWaitlist } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { useDialogs } from '../Dialogs';
import { Card, EmptyState } from '../Kit';
import { AppText } from '../Text';
import { useAction } from './useAction';

/**
 * Lista de espera (Fase 4): quién espera un horario y para qué día. Al liberarse un horario ese día, el sistema avisa a las
 * primeras personas (y al negocio por push); desde aquí se les puede escribir o quitarlas de la lista.
 */
export function WaitlistTab({ data, onGoTab }: { data: BookingAdminSettings; onGoTab: (tab: 'rules') => void }) {
  const { t, language } = useSettings();
  const { confirm } = useDialogs();
  const queryClient = useQueryClient();
  const list = useWaitlist();
  const action = useAction();
  const enabled = data.settings.waitlistEnabled;

  async function remove(entry: WaitlistEntryDto) {
    const ok = await confirm({ title: t('waitlist_remove'), message: t('waitlist_remove_confirm', { name: entry.customerName }), confirmLabel: t('waitlist_remove'), destructive: true });
    if (ok && (await action.run(() => api.cancelWaitlistEntry(entry.id)))) await queryClient.invalidateQueries({ queryKey: keys.waitlist });
  }

  const active = (list.data ?? []).filter((e) => e.status !== 'cancelled');
  return (
    <View style={{ gap: 12 }}>
      <AppText tone="muted">{t('waitlist_hint')}</AppText>
      {!enabled ? (
        <Card>
          <AppText variant="bodyStrong">{t('waitlist_off_title')}</AppText>
          <AppText variant="small" tone="muted">
            {t('waitlist_off_text')}
          </AppText>
          <Button label={t('discounts_go_rules')} variant="secondary" compact onPress={() => onGoTab('rules')} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
        </Card>
      ) : null}
      {action.error ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {action.error}
        </AppText>
      ) : null}
      {list.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
      {list.isError ? (
        <View style={{ gap: 8 }}>
          <AppText tone="danger">{t(errorKey(list.error))}</AppText>
          <Button label={t('retry')} variant="secondary" compact onPress={() => void list.refetch()} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      {list.data && active.length === 0 ? <EmptyState icon="hourglass-outline" message={t('waitlist_empty')} /> : null}
      {active.map((entry) => {
        const whatsapp = entry.customerPhone ? whatsappLink(entry.customerPhone, t('waitlist_whatsapp_message', { name: entry.customerName.split(' ')[0] ?? '', day: formatDay(entry.date, language) })) : null;
        return (
          <Card key={entry.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {upperFirst(formatDay(entry.date, language))}
              </AppText>
              <AppText variant="small" tone={entry.status === 'notified' ? 'success' : 'muted'}>
                {t(`waitlist_status_${entry.status}`)}
              </AppText>
            </View>
            <AppText>{entry.customerName}</AppText>
            <AppText variant="small" tone="muted">
              {[entry.services.map((s) => s.name).filter(Boolean).join(' · '), entry.customerPhone].filter(Boolean).join(' · ')}
            </AppText>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {whatsapp ? <Button label={t('waitlist_write')} compact onPress={() => void Linking.openURL(whatsapp)} /> : null}
              <Button label={t('waitlist_remove')} variant="secondary" compact disabled={action.busy} onPress={() => void remove(entry)} />
            </View>
          </Card>
        );
      })}
    </View>
  );
}
