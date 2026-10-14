import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { addMonths, formatMonth, monthGrid, upperFirst, weekdayShort } from '@/lib/agenda';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';

export type DayMark = 'available' | 'full' | 'closed';

interface CalendarPickerProps {
  /** Día elegido, "AAAA-MM-DD". */
  value: string;
  onChange: (date: string) => void;
  /** Hoy en la zona del negocio: los días anteriores no se pueden elegir (salvo `allowPast`). */
  today: string;
  allowPast?: boolean;
  /** Estado de cada día (libre / sin cupo / cerrado). Sin dato = todavía no se sabe. */
  marks?: Record<string, DayMark>;
  /** Último día que se puede elegir (inclusive). */
  maxDate?: string;
  /** Primer día que se puede elegir (inclusive), p. ej. el "hasta" de un rango no puede ser antes del "desde". */
  minDate?: string;
  onMonthChange?: (firstDayOfMonth: string) => void;
}

/**
 * Calendario mensual táctil (Android, iOS y Web, sin librerías): semanas de lunes a domingo, mes anterior/siguiente y
 * marcas por día. El estado nunca va solo en el color: cada día tiene nombre accesible ("martes 6 de octubre, con cupo").
 */
export function CalendarPicker({ value, onChange, today, allowPast, marks, maxDate, minDate, onMonthChange }: CalendarPickerProps) {
  const { colors, language, t } = useSettings();
  const [month, setMonth] = useState(`${value.slice(0, 7)}-01`);
  useEffect(() => setMonth(`${value.slice(0, 7)}-01`), [value]);

  const go = (delta: number) => {
    const next = addMonths(month, delta);
    setMonth(next);
    onMonthChange?.(next);
  };
  const weeks = monthGrid(month);
  const label = (date: string, mark?: DayMark) => {
    const base = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
    return mark === 'available' ? `${base}, ${t('cal_available')}` : mark === 'full' ? `${base}, ${t('cal_full')}` : mark === 'closed' ? `${base}, ${t('cal_closed')}` : base;
  };

  return (
    <View>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('cal_prev_month')} onPress={() => go(-1)} hitSlop={8} style={styles.nav}>
          <Ionicons name="chevron-back" size={22} color={colors.textMuted} />
        </Pressable>
        <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
          {upperFirst(formatMonth(month, language))}
        </AppText>
        <Pressable accessibilityRole="button" accessibilityLabel={t('cal_next_month')} onPress={() => go(1)} hitSlop={8} style={styles.nav}>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <View key={weekday} style={styles.cell}>
            <AppText variant="small" tone="muted" style={{ textTransform: 'capitalize' }}>
              {weekdayShort(weekday, language).slice(0, 3)}
            </AppText>
          </View>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={styles.row}>
          {week.map((date) => {
            const inMonth = date.slice(0, 7) === month.slice(0, 7);
            // Los días pasados no se marcan: no se pueden elegir y un punto rojo de "sin cupo" confundiría.
            const mark = date >= today ? marks?.[date] : undefined;
            const past = !allowPast && date < today;
            const beyond = Boolean((maxDate && date > maxDate) || (minDate && date < minDate));
            const disabled = past || beyond || mark === 'closed';
            const selected = date === value;
            return (
              <View key={date} style={styles.cell}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel={label(date, mark)}
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  onPress={() => onChange(date)}
                  style={[styles.day, { borderColor: selected ? colors.gold : date === today ? colors.border : 'transparent', backgroundColor: selected ? colors.gold : 'transparent', opacity: disabled ? 0.35 : inMonth ? 1 : 0.55 }]}>
                  <AppText variant="bodyStrong" style={{ color: selected ? colors.onGold : colors.text }}>
                    {Number(date.slice(8))}
                  </AppText>
                  {mark === 'available' ? <View style={[styles.mark, { backgroundColor: selected ? colors.onGold : colors.success }]} /> : mark === 'full' ? <View style={[styles.mark, { backgroundColor: selected ? colors.onGold : colors.danger }]} /> : <View style={styles.mark} />}
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
      <View style={styles.legend}>
        <View style={[styles.mark, { backgroundColor: colors.success }]} />
        <AppText variant="small" tone="muted">
          {t('cal_available')}
        </AppText>
        <View style={[styles.mark, { backgroundColor: colors.danger, marginLeft: 12 }]} />
        <AppText variant="small" tone="muted">
          {t('cal_full')}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  nav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  day: { width: 42, height: 46, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  mark: { width: 6, height: 6, borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
});
