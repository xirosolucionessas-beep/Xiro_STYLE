import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import type { HomeAlert } from '@/lib/alerts';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { useLuxury } from '../luxuryTokens';
import { radius } from '../theme';
import { Skeleton } from './Skeleton';

/** Texto de la insignia de una alerta: su cantidad si la tiene (p. ej. 3 productos) o "!" si es un aviso sin número. */
export const alertBadge = (alert: HomeAlert): string => String(alert.detailParams?.n ?? '!');

/** Tarjeta "Alertas": las pendientes (sin leer) con su contador. Es el MISMO cálculo que la insignia de la campana. */
export function AlertsCard({ alerts, loading, onOpen }: { alerts: readonly HomeAlert[]; loading: boolean; onOpen: (alert: HomeAlert) => void }) {
  const { t, colors } = useSettings();
  const tk = useLuxury();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.title}>
        <AppText variant="heading">{t('home_alerts')}</AppText>
        {alerts.length > 0 ? (
          <View style={[styles.count, { backgroundColor: tk.badge.urgent }]} accessible accessibilityLabel={String(alerts.length)}>
            <AppText variant="small" style={styles.countText}>
              {alerts.length}
            </AppText>
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={{ gap: 10, paddingVertical: 6 }}>
          <Skeleton height={36} radius={12} />
          <Skeleton height={36} radius={12} />
        </View>
      ) : alerts.length === 0 ? (
        <AppText tone="success" variant="bodyStrong" style={{ paddingVertical: 8 }} accessibilityLiveRegion="polite">
          {t('home_all_good')}
        </AppText>
      ) : (
        alerts.map((alert, index) => (
          <Pressable
            key={alert.signature}
            accessibilityRole="button"
            accessibilityLabel={`${t(alert.titleKey)}${alert.detailKey ? `. ${t(alert.detailKey, alert.detailParams)}` : ''}`}
            onPress={() => onOpen(alert)}
            style={[styles.row, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={[styles.dot, { backgroundColor: tk.badge[alert.priority] }]}>
              <AppText variant="small" style={{ color: tk.badge.text, fontWeight: '800' }}>
                {alertBadge(alert)}
              </AppText>
            </View>
            <AppText style={{ flex: 1 }} numberOfLines={2}>
              {t(alert.titleKey)}
            </AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 12 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  count: { minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { color: '#ffffff', fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  dot: { minWidth: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
