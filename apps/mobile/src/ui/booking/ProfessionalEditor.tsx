import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, type ProfessionalDto, type ScheduleBlock } from '@xiro/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { addDays, formatClock, formatDay, localDate, localTime, todayIn, upperFirst } from '@/lib/agenda';
import { api } from '@/lib/api';
import { blocksFromHours, blocksProblem, timeOffRange } from '@/lib/bookingPage';
import { toInt } from '@/lib/forms';
import { pickFromLibrary, uploadableImage } from '@/lib/images';
import { keys, useAllItems, useBookingSettings } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { CalendarPicker } from '../agenda/CalendarPicker';
import { Button } from '../Button';
import { CheckRow } from '../CheckRow';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { FormModal } from '../FormModal';
import { Card, Chip, ChipRow, Photo, SectionTitle, ToggleRow } from '../Kit';
import { AppText } from '../Text';
import { TimeField } from './TimeField';
import { useAction } from './useAction';
import { WeeklyBlocksEditor } from './WeeklyBlocksEditor';

const DAY_COUNTS = [1, 2, 3, 5, 7, 14, 30];

/**
 * Ficha de una persona que atiende: cómo se ve en la web (nombre, presentación, foto), su horario propio (vacío = sigue el
 * del negocio), qué servicios hace (con precio o duración propios) y sus ausencias. Cada bloque se guarda por separado.
 */
export function ProfessionalEditor({ professional, onClose }: { professional: ProfessionalDto; onClose: () => void }) {
  const { t, language } = useSettings();
  const { business } = useSession();
  const { toast, confirm } = useDialogs();
  const queryClient = useQueryClient();
  const timezone = business?.timezone ?? 'America/Bogota';
  const currency = business?.currency ?? 'COP';
  const settings = useBookingSettings();
  // Servicios que puede atender (solo servicios: el servidor ya los filtra).
  const items = useAllItems({ kind: 'service' });
  const services = items.data ?? [];

  const profileAction = useAction();
  const scheduleAction = useAction();
  const servicesAction = useAction();
  const offAction = useAction();
  const photoAction = useAction();

  const [name, setName] = useState(professional.publicName);
  const [bio, setBio] = useState(professional.bio);
  const [specialty, setSpecialty] = useState(professional.specialty);
  const [ownSchedule, setOwnSchedule] = useState(professional.schedule.length > 0);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(professional.schedule);
  const [all, setAll] = useState(professional.serviceIds.length === 0);
  const [chosen, setChosen] = useState<Record<string, { price: string; minutes: string }>>({});
  const [off, setOff] = useState({ date: todayIn(timezone), allDay: true, days: 1, from: '09:00', to: '12:00', reason: '' });

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.professionals });
  const timeOff = useQuery({ queryKey: ['time-off', professional.id], queryFn: () => api.timeOff(professional.id) });

  useEffect(() => {
    setChosen(Object.fromEntries(professional.serviceOverrides.map((o) => [o.itemId, { price: o.priceOverride === null ? '' : String(o.priceOverride), minutes: o.durationOverride === null ? '' : String(o.durationOverride) }])));
  }, [professional.serviceOverrides]);

  const today = todayIn(timezone);
  const businessBlocks = settings.data?.settings.hoursBlocks ?? blocksFromHours(business?.hours);

  async function saveProfile() {
    const saved = await profileAction.run(() => api.updateProfessional(professional.id, { publicName: name.trim(), bio: bio.trim(), specialty: specialty.trim() }));
    if (!saved) return;
    await refresh();
    toast(t('saved'));
  }

  async function changePhoto() {
    const [picked] = await pickFromLibrary(1);
    if (!picked) return;
    const saved = await photoAction.run(async () => api.uploadProfessionalPhoto(professional.id, await uploadableImage(picked)));
    if (saved) await refresh();
  }

  async function removePhoto() {
    const ok = await confirm({ title: t('prof_photo_remove_title'), message: t('prof_photo_remove_text'), confirmLabel: t('prof_photo_remove'), destructive: true });
    if (!ok) return;
    const saved = await photoAction.run(() => api.deleteProfessionalPhoto(professional.id));
    if (saved) await refresh();
  }

  async function saveSchedule() {
    const next = ownSchedule ? blocks : [];
    const problem = blocksProblem(next);
    if (problem) return scheduleAction.setError(t(problem));
    const saved = await scheduleAction.run(() => api.saveSchedule(professional.id, next));
    if (!saved) return;
    await refresh();
    toast(t('saved'));
  }

  async function saveServices() {
    const list = all ? [] : Object.entries(chosen).map(([itemId, v]) => ({ itemId, priceOverride: v.price ? toInt(v.price) : null, durationOverride: v.minutes ? toInt(v.minutes) : null }));
    if (!all && list.length === 0) return servicesAction.setError(t('prof_err_services'));
    const saved = await servicesAction.run(() => api.saveProfessionalServices(professional.id, list));
    if (!saved) return;
    await refresh();
    toast(t('saved'));
  }

  async function addOff() {
    const range = timeOffRange({ date: off.date, allDay: off.allDay, days: off.days, from: off.from, to: off.to }, timezone);
    if ('error' in range) return offAction.setError(t(range.error));
    const saved = await offAction.run(() => api.addTimeOff(professional.id, { ...range, reason: off.reason.trim() }));
    if (!saved) return;
    setOff((c) => ({ ...c, reason: '' }));
    await queryClient.invalidateQueries({ queryKey: ['time-off', professional.id] });
    toast(t('saved'));
  }

  async function removeOff(id: string) {
    const ok = await confirm({ title: t('prof_off_delete_title'), confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    await offAction.run(() => api.deleteTimeOff(id));
    await queryClient.invalidateQueries({ queryKey: ['time-off', professional.id] });
  }

  return (
    <FormModal title={professional.publicName} subtitle={professional.isOwner ? t('prof_you') : undefined} onClose={onClose}>
      <SectionTitle>{t('prof_profile')}</SectionTitle>
      <View style={styles.photoRow}>
        <Photo url={professional.photoUrl} size={96} icon="person-outline" />
        <View style={{ flex: 1, gap: 6 }}>
          <AppText variant="small" tone="muted">
            {t('prof_photo_hint')}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label={t(professional.photoUrl ? 'prof_photo_change' : 'prof_photo_add')} icon="image-outline" variant="secondary" compact loading={photoAction.busy} onPress={() => void changePhoto()} style={{ alignSelf: 'flex-start' }} />
            {professional.photoUrl ? <Button label={t('prof_photo_remove')} icon="trash-outline" variant="ghost" compact loading={photoAction.busy} onPress={() => void removePhoto()} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
          {photoAction.error ? (
            <AppText tone="danger" variant="small">
              {photoAction.error}
            </AppText>
          ) : null}
        </View>
      </View>
      <Field label={t('prof_public_name')} value={name} onChangeText={setName} hint={t('prof_public_name_hint')} maxLength={60} error={profileAction.fields.publicName} />
      <Field label={t('prof_specialty')} value={specialty} onChangeText={setSpecialty} hint={t('prof_specialty_hint')} maxLength={60} error={profileAction.fields.specialty} />
      <Field label={t('prof_bio')} value={bio} onChangeText={setBio} multiline maxLength={400} error={profileAction.fields.bio} />
      {profileAction.error ? (
        <AppText tone="danger" style={{ marginBottom: 8 }} accessibilityLiveRegion="polite">
          {profileAction.error}
        </AppText>
      ) : null}
      <Button label={t('save_changes')} compact loading={profileAction.busy} onPress={() => void saveProfile()} style={{ alignSelf: 'flex-start' }} />

      <SectionTitle>{t('prof_schedule')}</SectionTitle>
      <Card>
        <ToggleRow
          label={t('prof_schedule_own')}
          value={ownSchedule}
          onChange={(on) => {
            setOwnSchedule(on);
            if (on && blocks.length === 0) setBlocks(businessBlocks);
          }}
        />
        <AppText variant="small" tone="muted">
          {ownSchedule ? t('prof_schedule_own_on') : t('prof_schedule_own_off')}
        </AppText>
      </Card>
      {ownSchedule ? (
        <View style={{ marginTop: 10 }}>
          <WeeklyBlocksEditor blocks={blocks} onChange={setBlocks} />
        </View>
      ) : null}
      {scheduleAction.error ? (
        <AppText tone="danger" style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
          {scheduleAction.error}
        </AppText>
      ) : null}
      <Button label={t('save_changes')} compact loading={scheduleAction.busy} onPress={() => void saveSchedule()} style={{ alignSelf: 'flex-start', marginTop: 10 }} />

      <SectionTitle>{t('prof_services')}</SectionTitle>
      <Card>
        <ToggleRow label={t('prof_services_all')} value={all} onChange={setAll} />
        <AppText variant="small" tone="muted">
          {all ? t('prof_services_all_on') : t('prof_services_all_off')}
        </AppText>
      </Card>
      {!all
        ? services.map((item) => {
            const on = item.id in chosen;
            const value = chosen[item.id];
            return (
              <View key={item.id}>
                <CheckRow
                  label={item.name}
                  hint={`${formatMoney(item.price, currency)} · ${t('minutes_short', { minutes: item.durationMinutes })}`}
                  checked={on}
                  onChange={(next) =>
                    setChosen((c) => {
                      const copy = { ...c };
                      if (next) copy[item.id] = { price: '', minutes: '' };
                      else delete copy[item.id];
                      return copy;
                    })
                  }
                />
                {on && value ? (
                  <View style={styles.override}>
                    <View style={{ flex: 1 }}>
                      <Field label={t('prof_price_own')} value={value.price} onChangeText={(v) => setChosen((c) => ({ ...c, [item.id]: { ...value, price: v.replace(/\D/g, '') } }))} keyboardType="number-pad" prefix="$" placeholder={String(item.price)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label={t('prof_minutes_own')} value={value.minutes} onChangeText={(v) => setChosen((c) => ({ ...c, [item.id]: { ...value, minutes: v.replace(/\D/g, '') } }))} keyboardType="number-pad" placeholder={String(item.durationMinutes)} />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        : null}
      {!all && services.length === 0 ? <AppText tone="muted">{t('appt_no_services')}</AppText> : null}
      {servicesAction.error ? (
        <AppText tone="danger" style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
          {servicesAction.error}
        </AppText>
      ) : null}
      <Button label={t('save_changes')} compact loading={servicesAction.busy} onPress={() => void saveServices()} style={{ alignSelf: 'flex-start', marginTop: 10 }} />

      <SectionTitle>{t('prof_off_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 8 }}>
        {t('prof_off_hint')}
      </AppText>
      <Card>
        <CalendarPicker value={off.date} onChange={(date) => setOff((c) => ({ ...c, date }))} today={today} maxDate={addDays(today, 730)} />
        <View style={{ height: 8 }} />
        <ToggleRow label={t('prof_off_all_day')} value={off.allDay} onChange={(allDay) => setOff((c) => ({ ...c, allDay }))} />
        {off.allDay ? (
          <View>
            <AppText variant="small" tone="muted" style={{ marginBottom: 4 }}>
              {t('prof_off_days')}
            </AppText>
            <ChipRow label={t('prof_off_days')}>
              {DAY_COUNTS.map((days) => (
                <Chip key={days} label={String(days)} selected={off.days === days} onPress={() => setOff((c) => ({ ...c, days }))} />
              ))}
            </ChipRow>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10, marginVertical: 6 }}>
            <TimeField label={t('prof_off_from')} value={off.from} onChange={(from) => setOff((c) => ({ ...c, from }))} />
            <TimeField label={t('prof_off_to')} value={off.to} onChange={(to) => setOff((c) => ({ ...c, to }))} />
          </View>
        )}
        <Field label={t('prof_off_reason')} value={off.reason} onChangeText={(reason) => setOff((c) => ({ ...c, reason }))} maxLength={80} />
        {offAction.error ? (
          <AppText tone="danger" style={{ marginBottom: 8 }} accessibilityLiveRegion="polite">
            {offAction.error}
          </AppText>
        ) : null}
        <Button label={t('prof_off_add')} icon="add" compact loading={offAction.busy} onPress={() => void addOff()} style={{ alignSelf: 'flex-start' }} />
      </Card>
      <View style={{ marginTop: 10, gap: 6 }}>
        {(timeOff.data ?? [])
          .filter((o) => new Date(o.endsAt).getTime() > Date.now())
          .map((o) => (
            <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">
                  {upperFirst(formatDay(localDate(o.startsAt, timezone), language, { weekday: 'short', day: 'numeric', month: 'short' }))} · {formatClock(localTime(o.startsAt, timezone), language)} – {formatClock(localTime(o.endsAt, timezone), language)}
                </AppText>
                {o.reason ? (
                  <AppText variant="small" tone="muted">
                    {o.reason}
                  </AppText>
                ) : null}
              </View>
              <Pressable accessibilityRole="button" onPress={() => void removeOff(o.id)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                <AppText tone="danger" variant="bodyStrong">
                  {t('delete')}
                </AppText>
              </Pressable>
            </View>
          ))}
        {timeOff.data && timeOff.data.filter((o) => new Date(o.endsAt).getTime() > Date.now()).length === 0 ? <AppText tone="muted">{t('prof_off_empty')}</AppText> : null}
      </View>
    </FormModal>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  override: { flexDirection: 'row', gap: 10, paddingLeft: 36 },
});
