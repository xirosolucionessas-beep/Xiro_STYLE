import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { HOUR_OPTIONS, minuteOptions } from '@/lib/hours';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { AppText } from '../Text';
import { radius } from '../theme';

const OPTION_HEIGHT = 44;
const GAP = 6;

/**
 * Selector de hora ("HH:MM") con listas de horas y minutos (sin dependencias nativas, igual en Android, iOS y Web).
 * Un botón compacto muestra la hora y abre una hoja para cambiarla.
 */
export function TimeField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (time: string) => void; disabled?: boolean }) {
  const { t, colors } = useSettings();
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState(value.slice(0, 2));
  const [minute, setMinute] = useState(value.slice(3, 5));

  const show = () => {
    setHour(value.slice(0, 2));
    setMinute(value.slice(3, 5));
    setOpen(true);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={show}
        style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface, opacity: disabled ? 0.5 : 1 }]}>
        <AppText variant="small" tone="muted">
          {label}
        </AppText>
        <AppText variant="bodyStrong">{value}</AppText>
      </Pressable>
      {open ? (
        <Modal transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={t('close')} />
          <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <AppText variant="heading" style={{ marginBottom: 12 }}>
              {label}
            </AppText>
            <View style={styles.columns}>
              <Column list={HOUR_OPTIONS} selected={hour} onSelect={setHour} name={t('reg_hours_hour')} />
              <Column list={minuteOptions(minute)} selected={minute} onSelect={setMinute} name={t('reg_hours_minute')} />
            </View>
            <Button
              label={`${hour}:${minute}`}
              onPress={() => {
                onChange(`${hour}:${minute}`);
                setOpen(false);
              }}
            />
            <Button label={t('cancel')} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </Modal>
      ) : null}
    </>
  );
}

/** Lista que abre ya desplazada al valor elegido. */
function Column({ list, selected, onSelect, name }: { list: string[]; selected: string; onSelect: (value: string) => void; name: string }) {
  const { colors } = useSettings();
  const ref = useRef<ScrollView>(null);
  return (
    <ScrollView ref={ref} style={{ flex: 1 }} contentContainerStyle={{ gap: GAP }} accessibilityLabel={name} onLayout={() => ref.current?.scrollTo({ y: Math.max(0, (list.indexOf(selected) - 1) * (OPTION_HEIGHT + GAP)), animated: false })}>
      {list.map((item) => {
        const on = item === selected;
        return (
          <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${name} ${item}`} onPress={() => onSelect(item)} style={[styles.option, { borderColor: colors.border, backgroundColor: on ? colors.surfaceAlt : 'transparent' }]}>
            <AppText tone="text" variant="bodyStrong">
              {item}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 92, minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6, justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: 20, paddingBottom: 28, maxHeight: '80%' },
  columns: { flexDirection: 'row', gap: 12, height: 260, marginBottom: 14 },
  option: { height: OPTION_HEIGHT, borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
