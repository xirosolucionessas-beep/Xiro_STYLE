import type { NotificationSettings } from '@xiro/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorKey } from '@/lib/api';
import { turnOff, turnOn } from '@/lib/notifications';
import { keys, useNotificationSettings } from '@/lib/queries';
import { push } from '@/lib/push';
import { useSettings } from '@/lib/settings';
import { useDialogs } from '@/ui/Dialogs';
import { Card, Row, SectionTitle, ToggleRow } from '@/ui/Kit';

const DEFAULTS: NotificationSettings = { enabled: false, loyaltyEnabled: true, billingEnabled: true, appointmentsEnabled: true, reviewsEnabled: true };

/** Sección "Notificaciones" de Ajustes. Mismo componente en web y nativo: lo específico de cada plataforma vive en lib/push(.web).ts. */
export function NotificationsSection() {
  const { t } = useSettings();
  const { toast, confirm } = useDialogs();
  const queryClient = useQueryClient();
  const { data } = useNotificationSettings();
  const [busy, setBusy] = useState(false);
  const settings = data ?? DEFAULTS;

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

  const toggleGeneral = (next: boolean) =>
    run(async () => {
      const deps = { push, current: settings, save };
      const result = next
        ? await turnOn({ ...deps, confirmRationale: () => confirm({ title: t('notifications'), message: t('notifications_enable_hint'), confirmLabel: t('notifications_enable_cta') }) })
        : await turnOff(deps);
      if (!result.ok && result.messageKey) toast(t(result.messageKey));
    });

  const toggleCategory = (field: 'loyaltyEnabled' | 'billingEnabled' | 'appointmentsEnabled' | 'reviewsEnabled') => (next: boolean) => run(async () => void (await save({ ...settings, [field]: next })));

  const sendTest = () =>
    run(async () => {
      const { sent } = await api.sendTestNotification();
      toast(t(sent > 0 ? 'notifications_test_sent' : 'notifications_test_failed'));
    });

  return (
    <>
      <SectionTitle>{t('notifications')}</SectionTitle>
      <Card>
        <ToggleRow icon="notifications-outline" label={t('notifications_enable_cta')} value={settings.enabled} onChange={(next) => void toggleGeneral(next)} />
        {settings.enabled ? (
          <>
            <ToggleRow icon="calendar-outline" label={t('notifications_category_appointments')} value={settings.appointmentsEnabled} onChange={(next) => void toggleCategory('appointmentsEnabled')(next)} />
            <ToggleRow icon="chatbubble-ellipses-outline" label={t('notifications_category_reviews')} value={settings.reviewsEnabled} onChange={(next) => void toggleCategory('reviewsEnabled')(next)} />
            <ToggleRow icon="star-outline" label={t('notifications_category_loyalty')} value={settings.loyaltyEnabled} onChange={(next) => void toggleCategory('loyaltyEnabled')(next)} />
            <ToggleRow icon="card-outline" label={t('notifications_category_billing')} value={settings.billingEnabled} onChange={(next) => void toggleCategory('billingEnabled')(next)} />
            <Row icon="paper-plane-outline" label={t('notifications_test_cta')} onPress={() => void sendTest()} />
          </>
        ) : null}
      </Card>
    </>
  );
}
