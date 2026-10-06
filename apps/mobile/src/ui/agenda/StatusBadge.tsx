import type { AppointmentStatus } from '@xiro/shared';
import { StyleSheet, View } from 'react-native';
import { STATUS_TONE, type StatusTone } from '@/lib/agenda';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';

/** Insignia del estado de una cita. El significado va SIEMPRE en el texto; el color y el punto solo lo refuerzan. */
export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { colors, t } = useSettings();
  const tone: StatusTone = STATUS_TONE[status];
  const color = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : tone === 'accent' ? colors.gold : colors.textMuted;
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: `${color}26` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText variant="small" style={{ color, fontWeight: '800' }}>
        {t(`appt_status_${status}`)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
