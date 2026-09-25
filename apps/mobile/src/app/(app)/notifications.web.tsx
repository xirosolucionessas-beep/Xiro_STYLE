/**
 * Ruta /notifications SOLO WEB (nativo: notifications.tsx, sin cambios). Centro de notificaciones con las mismas alertas
 * que la campana (calculadas con datos que la app ya consulta; leído/descartado se guarda en el navegador).
 * Presentación en src/web/screens/Notifications.tsx.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { relativeTime } from '@/lib/alerts';
import { push } from '@/lib/push';
import type { PushPermission } from '@/lib/pushTypes';
import { useAuthed } from '@/lib/session';
import { useHomeAlerts } from '@/lib/useHomeAlerts';
import { Header, Screen } from '@/ui/Screen';
import { NotificationsView, type NotificationItem } from '@/web/screens/Notifications';
import { useNow } from '@/web/services/useNow';
import { useWebText } from '@/web/services/useWebText';

export default function NotificationsWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { user } = useAuthed();
  const { visible, state, loading, read, readAll, dismiss } = useHomeAlerts();
  const [permission, setPermission] = useState<PushPermission>('unavailable');
  const now = useNow();

  useEffect(() => {
    let active = true;
    void push
      .permission()
      .then((value) => active && setPermission(value))
      .catch(() => active && setPermission('unavailable'));
    return () => {
      active = false;
    };
  }, []);

  const item = (alert: (typeof visible)[number]): NotificationItem => ({
    id: alert.signature,
    title: t(alert.titleKey),
    detail: alert.detailKey ? t(alert.detailKey, alert.detailParams) : undefined,
    time: relativeTime(state.seen[alert.signature] ?? now, now, language),
    priority: alert.priority,
  });
  const unread = visible.filter((alert) => !state.read.includes(alert.signature)).map(item);
  const done = visible.filter((alert) => state.read.includes(alert.signature)).map(item);
  const find = (id: string) => visible.find((alert) => alert.signature === id);

  return (
    <Screen header={<Header title={t('notifications')} subtitle={t('sec_notif_sub')} />}>
      <NotificationsView
        t={t}
        loading={loading}
        unread={unread}
        done={done}
        permissionOff={permission === 'denied'}
        onOpen={(id) => {
          const alert = find(id);
          if (!alert) return;
          read(alert);
          router.push(alert.href as never);
        }}
        onDismiss={(id) => {
          const alert = find(id);
          if (alert) dismiss(alert);
        }}
        onReadAll={readAll}
        onSettings={user.role === 'owner' ? () => router.push('/more') : undefined}
      />
    </Screen>
  );
}
