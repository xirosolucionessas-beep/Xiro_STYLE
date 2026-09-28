import { useQuery } from '@tanstack/react-query';
import type { AvailabilitySlot } from '@xiro/shared';
import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, errorKey, type AvailabilityQuery } from '@/lib/api';
import { addDays, monthGrid, todayIn } from '@/lib/agenda';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { AppText } from '../Text';
import { CalendarPicker, type DayMark } from './CalendarPicker';
import { SlotGrid } from './SlotGrid';

interface SchedulePickerProps {
  selection: Pick<AvailabilityQuery, 'services' | 'packages'>;
  /** 'any' = "Primero disponible" o el id de un profesional. */
  professionalId: string;
  /** Al mover una cita: ignórala al calcular horarios. */
  excludeAppointmentId?: string;
  timezone: string;
  date: string;
  onDate: (date: string) => void;
  /** Instante (ISO) elegido. */
  slot: string | null;
  onSlot: (slot: AvailabilitySlot) => void;
}

/**
 * Elegir día y hora reales: un calendario que marca los días con cupo y, debajo, los horarios del día elegido (libres,
 * ocupados o no disponibles). Lo comparten "Nueva cita" y "Mover cita". Los horarios los calcula el servidor con las
 * mismas reglas que valida al guardar, así que lo que se ve libre aquí se puede agendar.
 */
export function SchedulePicker({ selection, professionalId, excludeAppointmentId, timezone, date, onDate, slot, onSlot }: SchedulePickerProps) {
  const { t } = useSettings();
  const today = todayIn(timezone);
  const [month, setMonth] = useState(`${date.slice(0, 7)}-01`);
  const ready = selection.services.length + selection.packages.length > 0;
  const base = useMemo(() => ({ ...selection, professionalId, ...(excludeAppointmentId ? { excludeAppointmentId } : {}) }), [selection, professionalId, excludeAppointmentId]);
  const grid = monthGrid(month);
  const from = grid[0]![0]!;
  const days = Math.min(62, grid.length * 7);

  const marksQuery = useQuery({ queryKey: ['booking-days', base, from, days], queryFn: () => api.staffDays({ ...base, from, days }), enabled: ready, staleTime: 20_000 });
  const slotsQuery = useQuery({ queryKey: ['booking-slots', base, date], queryFn: () => api.staffAvailability({ ...base, date }), enabled: ready, staleTime: 10_000 });

  const marks = useMemo(() => {
    const out: Record<string, DayMark> = {};
    for (const day of marksQuery.data ?? []) out[day.date] = !day.open ? 'closed' : day.hasAvailability ? 'available' : 'full';
    return out;
  }, [marksQuery.data]);

  if (!ready) return <AppText tone="muted">{t('sched_pick_services_first')}</AppText>;

  return (
    <View style={{ gap: 14 }}>
      <CalendarPicker value={date} onChange={onDate} today={today} allowPast={false} marks={marks} onMonthChange={setMonth} maxDate={addDays(today, 365)} />
      <AppText variant="label" tone="gold" accessibilityRole="header">
        {t('sched_times')}
      </AppText>
      {slotsQuery.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
      {slotsQuery.isError ? (
        <View style={{ gap: 8 }}>
          <AppText tone="danger">{t(errorKey(slotsQuery.error))}</AppText>
          <Button label={t('retry')} variant="secondary" compact onPress={() => void slotsQuery.refetch()} />
        </View>
      ) : null}
      {slotsQuery.data && slotsQuery.data.slots.length === 0 ? <AppText tone="muted">{t('sched_closed_day')}</AppText> : null}
      {slotsQuery.data && slotsQuery.data.slots.length > 0 ? (
        <>
          {slotsQuery.data.slots.every((s) => s.state !== 'available') ? <AppText tone="muted">{t('sched_no_free')}</AppText> : null}
          <SlotGrid slots={slotsQuery.data.slots} value={slot} onChange={onSlot} />
          <AppText variant="small" tone="muted">
            {t('sched_duration', { minutes: slotsQuery.data.totalMinutes })}
          </AppText>
        </>
      ) : null}
    </View>
  );
}
