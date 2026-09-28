import { formatMoney, whatsappLink, type AppointmentDto, type AvailabilitySlot } from '@xiro/shared';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { ApiError, api } from '@/lib/api';
import { actionStatus, availableActions, canReschedule, formatClock, formatDay, formatSpan, localDate, localTime, type AppointmentAction } from '@/lib/agenda';
import { apiErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { FormModal } from '../FormModal';
import { Card, Chip, ChipRow, SectionTitle } from '../Kit';
import { AppText } from '../Text';
import { SchedulePicker } from './SchedulePicker';
import { StatusBadge } from './StatusBadge';

interface Props {
  appointment: AppointmentDto;
  onClose: () => void;
  /** Algo cambió; `business` = también cambiaron cobros, existencias o fidelización (se completó la cita). */
  onChanged: (options: { business: boolean }) => void;
  /** Puede cambiar estado, mover y editar notas (permiso "crear y editar citas"). */
  canManage: boolean;
}

const ACTION_VARIANT: Record<AppointmentAction, 'primary' | 'secondary' | 'danger'> = { confirm: 'primary', start: 'secondary', complete: 'primary', no_show: 'danger', cancel: 'danger' };

/**
 * Ficha de una cita: quién, qué, cuándo y cuánto; acciones según el estado (confirmar, iniciar, completar, no asistió,
 * cancelar), mover a otro horario con disponibilidad real y notas internas. Completar cobra los servicios y productos,
 * suma el sello de fidelización y descuenta existencias (lo hace el servidor en una sola operación).
 */
export function AppointmentDetail({ appointment, onClose, onChanged, canManage }: Props) {
  const { t, language } = useSettings();
  const { business } = useSession();
  const { confirm, toast } = useDialogs();
  const timezone = business?.timezone ?? 'America/Bogota';
  const currency = business?.currency ?? 'COP';

  const [current, setCurrent] = useState(appointment);
  const [notes, setNotes] = useState(appointment.internalNotes);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(localDate(appointment.startsAt, timezone));
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [alternatives, setAlternatives] = useState<AvailabilitySlot[]>([]);

  const actions = availableActions(current.status, current.startsAt);
  const selection = useMemo(
    () => ({
      services: current.items.filter((i) => i.kind === 'service' && i.itemId).map((i) => ({ itemId: i.itemId!, variantId: i.variantId })),
      packages: current.items.filter((i) => i.kind === 'package' && i.packageId).map((i) => i.packageId!),
    }),
    [current.items],
  );

  async function run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setMessage(null);
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'slot_taken') {
        setAlternatives((error.extra.alternatives as AvailabilitySlot[] | undefined) ?? []);
        setSlot(null);
        setMessage({ tone: 'danger', text: t('slot_taken') });
      } else {
        const result = apiErrors(error, t);
        setMessage({ tone: 'danger', text: result.general ?? Object.values(result.fields)[0] ?? t('unknown_error') });
      }
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function act(action: AppointmentAction) {
    const status = actionStatus(action);
    if (action === 'cancel' || action === 'no_show' || action === 'complete') {
      const ok = await confirm({
        title: t(`appt_confirm_${action}_title`),
        message: t(`appt_confirm_${action}_text`),
        confirmLabel: t(`appt_action_${action}`),
        destructive: action !== 'complete',
      });
      if (!ok) return;
    }
    const updated = await run(action, () => api.setAppointmentStatus(current.id, status));
    if (!updated) return;
    setCurrent(updated);
    onChanged({ business: action === 'complete' });
    toast(updated.rewardJustEarned ? t('appt_reward_earned') : t(`appt_done_${action}`));
  }

  async function saveNotes() {
    const updated = await run('notes', () => api.updateAppointment(current.id, { internalNotes: notes.trim() }));
    if (!updated) return;
    setCurrent(updated);
    setNotes(updated.internalNotes);
    onChanged({ business: false });
    toast(t('saved'));
  }

  async function saveMove() {
    if (!slot) return setMessage({ tone: 'danger', text: t('appt_err_slot') });
    const updated = await run('move', () => api.updateAppointment(current.id, { startsAt: slot }));
    if (!updated) return;
    setCurrent(updated);
    setMoving(false);
    setSlot(null);
    setAlternatives([]);
    onChanged({ business: false });
    toast(t('appt_moved'));
  }

  const start = localTime(current.startsAt, timezone);
  const whatsappMessage = t('appt_whatsapp_message', { name: current.client.name.split(' ')[0] ?? '', business: business?.name ?? '', date: formatDay(localDate(current.startsAt, timezone), language), time: formatClock(start, language) });

  return (
    <FormModal title={current.client.name} subtitle={`${formatDay(localDate(current.startsAt, timezone), language)} · ${formatSpan(current.startsAt, current.endsAt, timezone, language)}`} onClose={onClose}>
      <View style={styles.badgeRow}>
        <StatusBadge status={current.status} />
        <AppText variant="small" tone="muted">
          {t(`appt_source_${current.source}`)}
        </AppText>
      </View>

      {message ? (
        <AppText tone={message.tone} style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
          {message.text}
        </AppText>
      ) : null}

      {canManage && actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Button key={action} label={t(`appt_action_${action}`)} variant={ACTION_VARIANT[action]} compact loading={busy === action} disabled={busy !== null} onPress={() => void act(action)} />
          ))}
        </View>
      ) : null}

      <SectionTitle>{t('appt_detail_what')}</SectionTitle>
      <Card>
        {current.items.map((item) => (
          <View key={item.id} style={styles.line}>
            <AppText style={{ flex: 1 }}>{item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name}</AppText>
            <AppText tone="muted">{formatMoney(item.price * item.quantity, currency)}</AppText>
          </View>
        ))}
        <View style={[styles.line, { marginTop: 6 }]}>
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            {t('appt_total')}
          </AppText>
          <AppText variant="heading" tone="gold">
            {formatMoney(current.totalPrice, currency)}
          </AppText>
        </View>
        <AppText variant="small" tone="muted">
          {t('appt_professional_is', { name: current.professional.name })} · {t('minutes_short', { minutes: current.durationMinutes })}
        </AppText>
      </Card>

      <SectionTitle>{t('appt_client')}</SectionTitle>
      <Card>
        <AppText variant="bodyStrong">{current.client.name}</AppText>
        {current.client.phone ? <AppText tone="muted">+{current.client.phone}</AppText> : null}
        {current.client.email ? <AppText tone="muted">{current.client.email}</AppText> : null}
        {current.client.phone ? (
          <Button label="WhatsApp" icon="logo-whatsapp" variant="secondary" compact style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => void Linking.openURL(whatsappLink(current.client.phone!, whatsappMessage))} />
        ) : null}
        {current.customerNotes ? (
          <View style={{ marginTop: 10 }}>
            <AppText variant="label" tone="gold">
              {t('appt_customer_notes')}
            </AppText>
            <AppText>{current.customerNotes}</AppText>
          </View>
        ) : null}
      </Card>

      {canManage && canReschedule(current.status) ? (
        <>
          <SectionTitle>{t('appt_move')}</SectionTitle>
          {moving ? (
            <View style={{ gap: 12 }}>
              <SchedulePicker selection={selection} professionalId={current.professional.id} excludeAppointmentId={current.id} timezone={timezone} date={date} onDate={(d) => { setDate(d); setSlot(null); }} slot={slot} onSlot={(s) => setSlot(s.startsAt)} />
              {alternatives.length > 0 ? (
                <ChipRow label={t('appt_alternatives')}>
                  {alternatives.map((alt) => (
                    <Chip key={alt.startsAt} label={`${localDate(alt.startsAt, timezone).slice(5)} · ${formatClock(alt.time, language)}`} onPress={() => { setDate(localDate(alt.startsAt, timezone)); setSlot(alt.startsAt); setAlternatives([]); setMessage(null); }} />
                  ))}
                </ChipRow>
              ) : null}
              <View style={styles.actions}>
                <Button label={t('appt_move_save')} compact loading={busy === 'move'} disabled={busy !== null || !slot} onPress={() => void saveMove()} />
                <Button label={t('cancel')} variant="ghost" compact onPress={() => { setMoving(false); setSlot(null); setMessage(null); }} />
              </View>
            </View>
          ) : (
            <Button label={t('appt_move_cta')} variant="secondary" compact style={{ alignSelf: 'flex-start' }} onPress={() => setMoving(true)} />
          )}
        </>
      ) : null}

      <SectionTitle>{t('appt_internal_notes')}</SectionTitle>
      <Field label={t('appt_internal_notes')} value={notes} onChangeText={setNotes} hint={t('appt_internal_hint')} multiline maxLength={1000} editable={canManage} />
      {canManage && notes !== current.internalNotes ? <Button label={t('save_changes')} compact loading={busy === 'notes'} disabled={busy !== null} onPress={() => void saveNotes()} style={{ alignSelf: 'flex-start' }} /> : null}
    </FormModal>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
});
