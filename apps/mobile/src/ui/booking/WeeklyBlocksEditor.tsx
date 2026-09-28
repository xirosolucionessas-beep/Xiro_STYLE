import { Ionicons } from '@expo/vector-icons';
import type { ScheduleBlock } from '@xiro/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { blocksOfDay, blocksProblem, copyDay, nextBlock, setDayBlocks, WEEK_ORDER } from '@/lib/bookingPage';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { AppText } from '../Text';
import { radius } from '../theme';
import { TimeField } from './TimeField';

/**
 * Horario semanal por bloques: cada día puede tener varios tramos (p. ej. 09:00–12:00 y 14:00–18:00: el hueco es el
 * almuerzo). Un día sin bloques es un día libre. Sirve para el horario del negocio y para el de cada profesional.
 */
export function WeeklyBlocksEditor({ blocks, onChange }: { blocks: ScheduleBlock[]; onChange: (next: ScheduleBlock[]) => void }) {
  const { t, colors } = useSettings();
  const problem = blocksProblem(blocks);

  return (
    <View style={{ gap: 10 }}>
      {WEEK_ORDER.map((weekday) => {
        const day = blocksOfDay(blocks, weekday);
        const replace = (index: number, patch: Partial<ScheduleBlock>) =>
          onChange(setDayBlocks(blocks, weekday, day.map((block, i) => (i === index ? { ...block, ...patch } : block))));
        return (
          <View key={weekday} style={[styles.day, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.head}>
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {t(`day_${weekday}`)}
              </AppText>
              {day.length === 0 ? <AppText tone="muted">{t('blocks_day_off')}</AppText> : null}
              {weekday !== 1 && blocksOfDay(blocks, 1).length > 0 && day.length === 0 ? (
                <Button label={t('blocks_copy_monday')} variant="ghost" compact onPress={() => onChange(copyDay(blocks, 1, [weekday]))} />
              ) : null}
            </View>
            {day.map((block, index) => (
              <View key={`${block.from}-${index}`} style={styles.block}>
                <TimeField label={t('reg_hours_open_time')} value={block.from} onChange={(from) => replace(index, { from })} />
                <AppText tone="muted">—</AppText>
                <TimeField label={t('reg_hours_close_time')} value={block.to} onChange={(to) => replace(index, { to })} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('blocks_remove')} hitSlop={8} onPress={() => onChange(setDayBlocks(blocks, weekday, day.filter((_, i) => i !== index)))} style={styles.remove}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </View>
            ))}
            <Button label={t('blocks_add')} icon="add" variant="ghost" compact style={{ alignSelf: 'flex-start' }} onPress={() => onChange(setDayBlocks(blocks, weekday, [...day, nextBlock(blocks, weekday)]))} />
          </View>
        );
      })}
      {problem ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {t(problem)}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  day: { borderWidth: 1, borderRadius: radius.lg, padding: 12, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  block: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
