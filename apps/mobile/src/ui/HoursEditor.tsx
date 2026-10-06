import { Ionicons } from '@expo/vector-icons';
import type { BusinessHours } from '@xiro/shared';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { applyRowChange, HOUR_OPTIONS, minuteOptions, rowsOf, setSameEveryDay, validateDay, type HoursRow } from '@/lib/hours';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { Toggle } from './Kit';
import { AppText } from './Text';
import { radius } from './theme';

const MIN_TOUCH = 48;
const OPTION_HEIGHT = MIN_TOUCH - 4;
const OPTION_GAP = 6;

/**
 * Horario del negocio en el registro. Misma lógica que la Web (src/lib/hours.ts): con "mismo horario todos los días"
 * hay 3 filas (lunes a viernes, sábado, domingo) y un cambio se aplica a los 7 días; sin él, siete filas.
 * Editar una fila abre una hoja con abierto/cerrado y listas de hora y minutos (sin dependencias nativas extra).
 */
export function HoursEditor({ hours, onChange }: { hours: BusinessHours; onChange: (next: BusinessHours) => void }) {
  const { t, colors } = useSettings();
  const [editing, setEditing] = useState<HoursRow | null>(null);
  const rows = rowsOf(hours);
  const labelOf = (row: HoursRow) => (row.id === 'weekdays' ? t('reg_hours_weekdays') : t(`day_${row.day}`));
  // La fila que se edita se relee del horario vigente para reflejar los cambios al instante.
  const current = editing ? (rows.find((row) => row.id === editing.id) ?? editing) : null;

  return (
    <View>
      <View style={styles.switchRow}>
        <AppText style={{ flex: 1 }}>{t('same_hours')}</AppText>
        <Toggle value={hours.sameEveryDay} onChange={(same) => onChange(setSameEveryDay(hours, same))} label={t('same_hours')} />
      </View>

      {rows.map((row) => {
        const invalid = validateDay(row) !== null;
        return (
          <Pressable
            key={String(row.id)}
            accessibilityRole="button"
            accessibilityLabel={`${t('reg_hours_edit', { day: labelOf(row) })}. ${row.open ? `${row.from} – ${row.to}` : t('closed')}`}
            onPress={() => setEditing(row)}
            style={[styles.row, { borderColor: invalid ? colors.danger : colors.border, backgroundColor: colors.surface }]}>
            <View style={[styles.dot, { backgroundColor: row.open ? colors.success : colors.textMuted }]} />
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{labelOf(row)}</AppText>
              <AppText tone={invalid ? 'danger' : 'muted'} variant="small">
                {row.open ? `${row.from} — ${row.to}` : t('closed')}
              </AppText>
            </View>
            <Ionicons name="create-outline" size={20} color={colors.textMuted} />
          </Pressable>
        );
      })}

      {current ? <RowSheet row={current} label={labelOf(current)} onClose={() => setEditing(null)} onPatch={(patch) => onChange(applyRowChange(hours, current, patch))} /> : null}
    </View>
  );
}

function RowSheet({ row, label, onClose, onPatch }: { row: HoursRow; label: string; onClose: () => void; onPatch: (patch: Partial<Pick<HoursRow, 'open' | 'from' | 'to'>>) => void }) {
  const { t, colors } = useSettings();
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const error = validateDay(row) ? t('hours_close_after_open') : null;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={picking ? () => setPicking(null) : onClose}>
      <Pressable style={styles.backdrop} onPress={picking ? () => setPicking(null) : onClose} accessibilityLabel={t('close')} accessibilityRole="button" />
      <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
        {picking ? (
          <TimePicker
            title={picking === 'from' ? t('reg_hours_open_time') : t('reg_hours_close_time')}
            value={picking === 'from' ? row.from : row.to}
            onPick={(time) => {
              onPatch(picking === 'from' ? { from: time } : { to: time });
              setPicking(null);
            }}
            onCancel={() => setPicking(null)}
          />
        ) : (
          <>
            <AppText variant="heading" style={{ marginBottom: 12 }}>
              {label}
            </AppText>
            <View style={styles.switchRow}>
              <AppText style={{ flex: 1 }}>{t('reg_hours_open_day')}</AppText>
              <Toggle value={row.open} onChange={(open) => onPatch({ open })} label={t('reg_hours_open_day')} />
            </View>
            {row.open ? (
              <View style={styles.times}>
                <TimeButton label={t('reg_hours_open_time')} value={row.from} onPress={() => setPicking('from')} />
                <TimeButton label={t('reg_hours_close_time')} value={row.to} onPress={() => setPicking('to')} />
              </View>
            ) : null}
            {error ? (
              <AppText tone="danger" variant="small" accessibilityLiveRegion="polite" style={{ marginBottom: 10 }}>
                {error}
              </AppText>
            ) : null}
            <Button label={t('continue')} onPress={onClose} disabled={Boolean(error)} />
          </>
        )}
      </View>
    </Modal>
  );
}

function TimeButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={[styles.time, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <AppText tone="gold" variant="label">
        {label}
      </AppText>
      <AppText variant="heading">{value}</AppText>
    </Pressable>
  );
}

/** Columna de opciones que abre ya desplazada al valor elegido (si no, con 09 elegido se vería la lista desde 00). */
function TimeColumn({ list, selected, onSelect, name }: { list: string[]; selected: string; onSelect: (value: string) => void; name: string }) {
  const { colors } = useSettings();
  const ref = useRef<ScrollView>(null);
  return (
    <ScrollView ref={ref} style={styles.column} contentContainerStyle={{ gap: OPTION_GAP }} accessibilityLabel={name} onLayout={() => ref.current?.scrollTo({ y: Math.max(0, (list.indexOf(selected) - 1) * (OPTION_HEIGHT + OPTION_GAP)), animated: false })}>
      {list.map((item) => {
        const on = item === selected;
        return (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${name} ${item}`}
            onPress={() => onSelect(item)}
            style={[styles.option, { borderColor: colors.border, backgroundColor: on ? colors.surfaceAlt : 'transparent' }]}>
            <AppText tone="text" variant="bodyStrong">
              {item}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function TimePicker({ title, value, onPick, onCancel }: { title: string; value: string; onPick: (time: string) => void; onCancel: () => void }) {
  const { t } = useSettings();
  const [hour, setHour] = useState(value.slice(0, 2));
  const [minute, setMinute] = useState(value.slice(3, 5));
  return (
    <>
      <AppText variant="heading" style={{ marginBottom: 12 }}>
        {title}
      </AppText>
      <View style={styles.columns}>
        <TimeColumn list={HOUR_OPTIONS} selected={hour} onSelect={setHour} name={t('reg_hours_hour')} />
        <TimeColumn list={minuteOptions(minute)} selected={minute} onSelect={setMinute} name={t('reg_hours_minute')} />
      </View>
      <Button label={`${hour}:${minute}`} onPress={() => onPick(`${hour}:${minute}`)} />
      <Button label={t('cancel')} variant="ghost" onPress={onCancel} />
    </>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH + 8, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: 20, paddingBottom: 28, maxHeight: '80%' },
  times: { flexDirection: 'row', gap: 10, marginVertical: 8, marginBottom: 14 },
  time: { flex: 1, minHeight: MIN_TOUCH + 12, borderWidth: 1, borderRadius: radius.lg, padding: 12, gap: 4 },
  columns: { flexDirection: 'row', gap: 12, height: 260, marginBottom: 14 },
  column: { flex: 1 },
  option: { height: OPTION_HEIGHT, borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
