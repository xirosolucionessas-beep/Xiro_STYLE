import { Ionicons } from '@expo/vector-icons';
import type { AppointmentDto } from '@xiro/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatClock, formatDay, localDate, localTime, summarizeItems } from '@/lib/agenda';
import { useSettings } from '@/lib/settings';
import { StatusBadge } from '../agenda/StatusBadge';
import { AppText } from '../Text';
import { radius } from '../theme';

/** Próximas citas en Inicio: día, hora, cliente y qué se hace. Cada fila abre la agenda. Sin citas, lo dice con claridad. */
export function UpcomingList({ appointments, timezone, loading, onOpen }: { appointments: AppointmentDto[]; timezone: string; loading?: boolean; onOpen: () => void }) {
  const { colors, t, language } = useSettings();
  if (appointments.length === 0) {
    return (
      <Pressable accessibilityRole="button" onPress={onOpen} style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="calendar-outline" size={26} color={colors.textMuted} />
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{loading ? t('loading') : t('home_upcoming_empty')}</AppText>
          {!loading ? (
            <AppText tone="muted" variant="small">
              {t('home_upcoming_empty_hint')}
            </AppText>
          ) : null}
        </View>
      </Pressable>
    );
  }
  return (
    <View style={[styles.box, styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {appointments.map((appt, index) => (
        <Pressable key={appt.id} accessibilityRole="button" onPress={onOpen} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
          <View style={styles.when}>
            <AppText variant="small" tone="muted" style={{ textTransform: 'capitalize' }}>
              {formatDay(localDate(appt.startsAt, timezone), language, { weekday: 'short', day: 'numeric' })}
            </AppText>
            <AppText variant="bodyStrong" tone="gold">
              {formatClock(localTime(appt.startsAt, timezone), language)}
            </AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {appt.client.name}
            </AppText>
            <AppText variant="small" tone="muted" numberOfLines={1}>
              {summarizeItems(appt.items)}
            </AppText>
          </View>
          <StatusBadge status={appt.status} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: radius.lg, padding: 16, marginTop: -6 },
  list: { flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10, minHeight: 56 },
  when: { width: 64 },
});
