import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { alertBadge } from '@/ui/home/AlertsCard';
import { relativeTime, type HomeAlert } from '@/lib/alerts';
import { push } from '@/lib/push';
import type { PushPermission } from '@/lib/pushTypes';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useHomeAlerts } from '@/lib/useHomeAlerts';
import { Button } from '@/ui/Button';
import { Card, EmptyState } from '@/ui/Kit';
import { useLuxury } from '@/ui/luxuryTokens';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

/**
 * Centro de notificaciones (campana del Inicio). Muestra las mismas alertas que la tarjeta "Alertas" — calculadas con datos
 * que la app ya consulta — y guarda en el dispositivo qué está leído o descartado (el backend no tiene historial).
 * Tocar una alerta la marca como leída y abre la pantalla correspondiente.
 */
export default function Notifications() {
  const router = useRouter();
  const { t, language, colors } = useSettings();
  const tk = useLuxury();
  const { user } = useAuthed();
  const { visible, pending, state, loading, read, readAll, dismiss } = useHomeAlerts();
  const [permission, setPermission] = useState<PushPermission>('unavailable');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void push.permission().then(setPermission).catch(() => setPermission('unavailable'));
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const unread = visible.filter((alert) => !state.read.includes(alert.signature));
  const done = visible.filter((alert) => state.read.includes(alert.signature));

  const open = (alert: HomeAlert) => {
    read(alert);
    router.push(alert.href);
  };

  const row = (alert: HomeAlert, isRead: boolean) => (
    <Card key={alert.signature} style={isRead ? { opacity: 0.65 } : undefined}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t(alert.titleKey)}${alert.detailKey ? `. ${t(alert.detailKey, alert.detailParams)}` : ''}`} onPress={() => open(alert)} style={styles.main}>
          <View style={[styles.dot, { backgroundColor: tk.badge[alert.priority] }]}>
            <AppText variant="small" style={{ color: tk.badge.text, fontWeight: '800' }}>
              {alertBadge(alert)}
            </AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t(alert.titleKey)}</AppText>
            {alert.detailKey ? (
              <AppText tone="muted" variant="small">
                {t(alert.detailKey, alert.detailParams)}
              </AppText>
            ) : null}
            <AppText tone="muted" variant="small" style={{ marginTop: 2 }}>
              {relativeTime(state.seen[alert.signature] ?? now, now, language)}
            </AppText>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('notif_dismiss')}: ${t(alert.titleKey)}`} onPress={() => dismiss(alert)} hitSlop={8} style={styles.dismiss}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </Card>
  );

  return (
    <Screen header={<Header title={t('notifications')} />}>
      {permission === 'denied' ? (
        <Card style={{ marginBottom: 12 }}>
          <AppText variant="small" accessibilityLiveRegion="polite">
            {t('notif_permission_off')}
          </AppText>
          <View style={{ marginTop: 10 }}>
            <Button label={t('notif_open_settings')} variant="secondary" compact onPress={() => void Linking.openSettings()} />
          </View>
        </Card>
      ) : null}

      <View style={styles.actions}>
        {pending.length > 0 ? <Button label={t('notif_mark_all')} variant="secondary" compact onPress={readAll} /> : null}
        {user.role === 'owner' ? <Button label={t('notif_settings')} variant="ghost" compact icon="settings-outline" onPress={() => router.push('/more')} /> : null}
      </View>

      {!loading && visible.length === 0 ? <EmptyState icon="notifications-off-outline" message={t('notif_empty')} /> : null}
      <View style={styles.list}>{unread.map((alert) => row(alert, false))}</View>
      {done.length > 0 ? (
        <>
          <AppText variant="label" tone="gold" style={styles.section} accessibilityRole="header">
            {t('notif_read_section').toUpperCase()}
          </AppText>
          <View style={styles.list}>{done.map((alert) => row(alert, true))}</View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  list: { gap: 10 },
  section: { marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  dot: { minWidth: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
