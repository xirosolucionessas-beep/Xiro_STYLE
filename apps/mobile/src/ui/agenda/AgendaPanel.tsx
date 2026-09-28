import { Ionicons } from '@expo/vector-icons';
import { can, formatMoney, type AppointmentDto } from '@xiro/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { addDays, dayRange, dayTotals, formatDay, groupByDay, localDate, startOfWeek, todayIn, upperFirst, weekDates, weekdayShort } from '@/lib/agenda';
import { errorKey } from '@/lib/api';
import { useAppointments, useInvalidateAppointments, useProfessionals } from '@/lib/queries';
import { useRealtimeAppointments } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { useDialogs } from '../Dialogs';
import { Card, Chip, ChipRow, EmptyState } from '../Kit';
import { Header, Screen } from '../Screen';
import { AppText } from '../Text';
import { radius } from '../theme';
import { AppointmentCard } from './AppointmentCard';
import { AppointmentDetail } from './AppointmentDetail';
import { NewAppointment } from './NewAppointment';

type View_ = 'day' | 'week';

/**
 * Agenda de citas (Android, iOS y Web): día o semana, filtro por profesional, resumen del día y alta / ficha de cada cita.
 * Un empleado sin "ver todas las agendas" solo recibe (y ve) sus propias citas: el servidor lo impone; aquí solo se esconde
 * el filtro que no le serviría.
 */
export function AgendaPanel() {
  const { t, language, colors } = useSettings();
  const { user, business } = useSession();
  const { toast } = useDialogs();
  const params = useLocalSearchParams<{ new?: string }>();
  const timezone = business?.timezone ?? 'America/Bogota';
  const currency = business?.currency ?? 'COP';
  const actor = user ? { role: user.role, permissions: user.permissions } : null;
  const canManage = actor ? can(actor, 'appointments_manage') : false;
  const seesAll = actor ? can(actor, 'agenda_all') : false;

  const today = todayIn(timezone);
  const [date, setDate] = useState(today);
  const [view, setView] = useState<View_>('day');
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.new === '1' && canManage);
  const [open, setOpen] = useState<AppointmentDto | null>(null);

  const professionals = useProfessionals(seesAll);
  const bookable = (professionals.data ?? []).filter((p) => p.bookable);

  const weekStart = startOfWeek(date);
  const range = useMemo(() => dayRange(weekStart, timezone, 7), [weekStart, timezone]);
  const appointments = useAppointments({ ...range, ...(professionalId ? { professionalId } : {}) });
  const invalidate = useInvalidateAppointments();

  // Al volver a la pantalla (otra persona o un cliente pudo reservar) se pide de nuevo.
  useFocusEffect(useCallback(() => void appointments.refetch(), [appointments.refetch]));
  // En web, además, sin esperar a volver a la pantalla: LISTEN/NOTIFY avisa apenas algo cambia (ver lib/realtime.web.ts).
  useRealtimeAppointments(useCallback(() => void invalidate(), [invalidate]));

  const byDay = useMemo(() => groupByDay(appointments.data ?? [], timezone), [appointments.data, timezone]);
  const dayList = byDay.get(date) ?? [];
  const totals = dayTotals(dayList);
  const goto = (next: string) => setDate(next);
  const step = view === 'day' ? 1 : 7;

  const label = view === 'day' ? formatDay(date, language) : `${formatDay(weekStart, language, { day: 'numeric', month: 'short' })} – ${formatDay(addDays(weekStart, 6), language, { day: 'numeric', month: 'short' })}`;

  return (
    <Screen
      header={<Header root title={t('nav_agenda')} subtitle={t('agenda_subtitle')} right={canManage ? <Button label={t('appt_new')} icon="add" compact onPress={() => setCreating(true)} /> : undefined} />}
      refreshing={appointments.isRefetching}
      onRefresh={() => void appointments.refetch()}>
      <View style={styles.nav}>
        <Pressable accessibilityRole="button" accessibilityLabel={view === 'day' ? t('agenda_prev_day') : t('agenda_prev_week')} onPress={() => goto(addDays(date, -step))} style={[styles.arrow, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.gold} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
            {upperFirst(label)}
          </AppText>
          {date !== today ? (
            <Pressable accessibilityRole="button" onPress={() => goto(today)} hitSlop={8}>
              <AppText variant="small" tone="gold">
                {t('agenda_today')}
              </AppText>
            </Pressable>
          ) : (
            <AppText variant="small" tone="muted">
              {t('agenda_today')}
            </AppText>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={view === 'day' ? t('agenda_next_day') : t('agenda_next_week')} onPress={() => goto(addDays(date, step))} style={[styles.arrow, { borderColor: colors.border }]}>
          <Ionicons name="chevron-forward" size={22} color={colors.gold} />
        </Pressable>
      </View>

      <ChipRow label={t('agenda_view')}>
        <Chip label={t('agenda_view_day')} selected={view === 'day'} onPress={() => setView('day')} />
        <Chip label={t('agenda_view_week')} selected={view === 'week'} onPress={() => setView('week')} />
        {seesAll && bookable.length > 1 ? (
          <>
            <Chip label={t('agenda_all_professionals')} selected={professionalId === null} onPress={() => setProfessionalId(null)} />
            {bookable.map((p) => (
              <Chip key={p.id} label={p.publicName} selected={professionalId === p.id} onPress={() => setProfessionalId(p.id)} />
            ))}
          </>
        ) : null}
      </ChipRow>

      <View style={styles.strip} accessibilityRole="tablist">
        {weekDates(date).map((d) => {
          const count = (byDay.get(d) ?? []).filter((a) => a.status !== 'cancelled' && a.status !== 'no_show').length;
          const selected = d === date;
          return (
            <Pressable
              key={d}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${formatDay(d, language)}, ${t('agenda_count', { count })}`}
              onPress={() => {
                goto(d);
                setView('day');
              }}
              style={[styles.stripDay, { borderColor: selected ? colors.gold : d === today ? colors.border : 'transparent', backgroundColor: selected ? colors.goldTint : 'transparent' }]}>
              <AppText variant="small" tone="muted" style={{ textTransform: 'capitalize' }}>
                {weekdayShort(new Date(`${d}T00:00:00Z`).getUTCDay(), language).slice(0, 3)}
              </AppText>
              <AppText variant="bodyStrong" tone={selected ? 'gold' : 'text'}>
                {Number(d.slice(8))}
              </AppText>
              <View style={[styles.count, { backgroundColor: count > 0 ? colors.gold : 'transparent' }]}>
                <AppText variant="small" style={{ color: colors.onGold, fontWeight: '800', fontSize: 11 }}>
                  {count > 0 ? count : ''}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {view === 'day' ? (
        <Card style={{ marginTop: 12 }}>
          <View style={styles.totals}>
            <Total label={t('agenda_total_appts')} value={String(totals.active + totals.completed)} />
            <Total label={t('agenda_total_pending')} value={String(totals.pending)} />
            <Total label={t('agenda_total_expected')} value={formatMoney(totals.expected + totals.earned, currency)} />
          </View>
        </Card>
      ) : null}

      {appointments.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('loading')} /> : null}
      {appointments.isError ? (
        <View style={{ marginTop: 16, gap: 8 }}>
          <AppText tone="danger" accessibilityLiveRegion="polite">
            {t(errorKey(appointments.error))}
          </AppText>
          <Button label={t('retry')} variant="secondary" compact onPress={() => void appointments.refetch()} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}

      {appointments.data && view === 'day' ? (
        dayList.length === 0 ? (
          <View>
            <EmptyState icon="calendar-outline" message={t('agenda_empty_day')} />
            {canManage ? <Button label={t('appt_new')} icon="add" variant="secondary" onPress={() => setCreating(true)} /> : null}
          </View>
        ) : (
          <View style={styles.list}>
            {dayList.map((appt) => (
              <AppointmentCard key={appt.id} appointment={appt} timezone={timezone} currency={currency} showProfessional={seesAll} onPress={() => setOpen(appt)} />
            ))}
          </View>
        )
      ) : null}

      {appointments.data && view === 'week' ? (
        appointments.data.length === 0 ? (
          <EmptyState icon="calendar-outline" message={t('agenda_empty_week')} />
        ) : (
          <View style={styles.list}>
            {weekDates(date)
              .filter((d) => (byDay.get(d) ?? []).length > 0)
              .map((d) => (
                <View key={d} style={{ gap: 10 }}>
                  <AppText variant="label" tone="gold" accessibilityRole="header" style={{ marginTop: 8 }}>
                    {formatDay(d, language).toUpperCase()}
                  </AppText>
                  {(byDay.get(d) ?? []).map((appt) => (
                    <AppointmentCard key={appt.id} appointment={appt} timezone={timezone} currency={currency} showProfessional={seesAll} onPress={() => setOpen(appt)} />
                  ))}
                </View>
              ))}
          </View>
        )
      ) : null}

      {creating ? (
        <NewAppointment
          initialDate={date}
          {...(professionalId ? { initialProfessionalId: professionalId } : {})}
          onClose={() => setCreating(false)}
          onCreated={async (created) => {
            setCreating(false);
            await invalidate();
            toast(t('appt_created'));
            setOpen(null);
            setDate(localDate(created.startsAt, timezone));
          }}
        />
      ) : null}
      {open ? (
        <AppointmentDetail
          appointment={open}
          canManage={canManage}
          onClose={() => setOpen(null)}
          onChanged={({ business: alsoBusiness }) => void invalidate(alsoBusiness)}
        />
      ) : null}
    </Screen>
  );
}


function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <AppText variant="small" tone="muted">
        {label}
      </AppText>
      <AppText variant="heading">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  arrow: { width: 46, height: 46, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', gap: 4, marginTop: 8 },
  stripDay: { flex: 1, alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, paddingVertical: 6, gap: 1, minHeight: 68 },
  count: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  totals: { flexDirection: 'row', gap: 12 },
  list: { gap: 12, marginTop: 12 },
});
