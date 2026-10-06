import { useQueryClient } from '@tanstack/react-query';
import { SLOT_INTERVALS, type BookingAdminSettings, type BookingSettingsInput, type CustomField } from '@xiro/shared';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { blocksFromHours, blocksProblem } from '@/lib/bookingPage';
import { addDays, formatDay, todayIn, upperFirst } from '@/lib/agenda';
import { api } from '@/lib/api';
import { keys, useClosures } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { CalendarPicker } from '../agenda/CalendarPicker';
import { Button } from '../Button';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { Card, Chip, ChipRow, SectionTitle, ToggleRow } from '../Kit';
import { AppText } from '../Text';
import { useAction } from './useAction';
import { WeeklyBlocksEditor } from './WeeklyBlocksEditor';

const NOTICE = [0, 30, 60, 120, 240, 720, 1440];
const AHEAD = [14, 30, 60, 90, 180, 365];
const CANCEL = [0, 2, 6, 12, 24, 48, 72];
const MODS = [0, 1, 2, 3, 5];
const PENDING = [1, 2, 3, 5, 10];

/** Primer identificador "campo_N" que no usa otro campo (las respuestas se guardan por identificador). */
const freeKey = (fields: CustomField[]) => {
  let n = fields.length + 1;
  while (fields.some((f) => f.key === `campo_${n}`)) n += 1;
  return `campo_${n}`;
};

const noticeLabel = (minutes: number, t: (k: string, p?: Record<string, string | number>) => string) =>
  minutes === 0 ? t('rules_none') : minutes < 60 ? t('minutes_short', { minutes }) : minutes < 1440 ? t('rules_hours', { hours: minutes / 60 }) : t('rules_days', { days: minutes / 1440 });

/** Reglas de agenda y reservas: cuadrícula, anticipación, cancelación, confirmación, campos extra, horario y días cerrados. */
export function RulesTab({ data }: { data: BookingAdminSettings }) {
  const { t, language } = useSettings();
  const { business } = useSession();
  const { toast, confirm } = useDialogs();
  const queryClient = useQueryClient();
  const save = useAction();
  const closuresAction = useAction();
  const closures = useClosures();
  const [settings, setSettings] = useState<BookingSettingsInput>(data.settings);
  const [custom, setCustom] = useState(data.settings.hoursBlocks !== null);
  const [closureDate, setClosureDate] = useState(todayIn(data.timezone));
  const [closureReason, setClosureReason] = useState('');
  const today = todayIn(data.timezone);

  useEffect(() => {
    setSettings(data.settings);
    setCustom(data.settings.hoursBlocks !== null);
  }, [data]);

  const patch = (next: Partial<BookingSettingsInput>) => setSettings((c) => ({ ...c, ...next }));
  const fields: CustomField[] = (settings.customFields ?? []).map((f) => ({ ...f, type: f.type ?? 'text', required: f.required ?? false }));
  const blocks = settings.hoursBlocks ?? [];
  const problem = custom ? blocksProblem(blocks) : null;

  async function submit() {
    if (problem) return save.setError(t(problem));
    const saved = await save.run(() => api.saveBookingSettings({ ...settings, hoursBlocks: custom ? blocks : null }));
    if (!saved) return;
    await queryClient.invalidateQueries({ queryKey: keys.bookingSettings });
    toast(t('saved'));
  }

  const setCustomHours = (on: boolean) => {
    setCustom(on);
    patch({ hoursBlocks: on ? blocksFromHours(business?.hours) : null });
  };

  async function addClosure() {
    const saved = await closuresAction.run(() => api.addClosure({ date: closureDate, reason: closureReason.trim() }));
    if (!saved) return;
    setClosureReason('');
    await queryClient.invalidateQueries({ queryKey: keys.closures });
    toast(t('saved'));
  }

  async function removeClosure(id: string) {
    const ok = await confirm({ title: t('rules_closure_delete_title'), confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    await closuresAction.run(() => api.deleteClosure(id));
    await queryClient.invalidateQueries({ queryKey: keys.closures });
  }

  return (
    <View>
      <SectionTitle>{t('rules_grid_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 6 }}>
        {t('rules_grid_hint')}
      </AppText>
      <ChipRow label={t('rules_grid_title')}>
        {SLOT_INTERVALS.map((minutes) => (
          <Chip key={minutes} label={t('minutes_short', { minutes })} selected={settings.slotIntervalMinutes === minutes} onPress={() => patch({ slotIntervalMinutes: minutes })} />
        ))}
      </ChipRow>

      <SectionTitle>{t('rules_notice_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 6 }}>
        {t('rules_notice_hint')}
      </AppText>
      <ChipRow label={t('rules_notice_title')}>
        {NOTICE.map((minutes) => (
          <Chip key={minutes} label={noticeLabel(minutes, t)} selected={settings.minNoticeMinutes === minutes} onPress={() => patch({ minNoticeMinutes: minutes })} />
        ))}
      </ChipRow>

      <SectionTitle>{t('rules_ahead_title')}</SectionTitle>
      <ChipRow label={t('rules_ahead_title')}>
        {AHEAD.map((days) => (
          <Chip key={days} label={t('rules_days', { days })} selected={settings.maxDaysAhead === days} onPress={() => patch({ maxDaysAhead: days })} />
        ))}
      </ChipRow>

      <SectionTitle>{t('rules_cancel_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 6 }}>
        {t('rules_cancel_hint')}
      </AppText>
      <ChipRow label={t('rules_cancel_title')}>
        {CANCEL.map((hours) => (
          <Chip key={hours} label={hours === 0 ? t('rules_anytime') : t('rules_hours', { hours })} selected={settings.cancelUntilHours === hours} onPress={() => patch({ cancelUntilHours: hours })} />
        ))}
      </ChipRow>

      <SectionTitle>{t('rules_mods_title')}</SectionTitle>
      <ChipRow label={t('rules_mods_title')}>
        {MODS.map((count) => (
          <Chip key={count} label={String(count)} selected={settings.maxModifications === count} onPress={() => patch({ maxModifications: count })} />
        ))}
      </ChipRow>

      <SectionTitle>{t('rules_pending_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 6 }}>
        {t('rules_pending_hint')}
      </AppText>
      <ChipRow label={t('rules_pending_title')}>
        {PENDING.map((count) => (
          <Chip key={count} label={String(count)} selected={settings.maxPendingPerPhone === count} onPress={() => patch({ maxPendingPerPhone: count })} />
        ))}
      </ChipRow>

      <SectionTitle>{t('rules_confirm_title')}</SectionTitle>
      <Card>
        <ToggleRow label={t('rules_auto_confirm')} value={settings.autoConfirm ?? true} onChange={(v) => patch({ autoConfirm: v })} />
        <AppText variant="small" tone="muted">
          {settings.autoConfirm ? t('rules_auto_confirm_on') : t('rules_auto_confirm_off')}
        </AppText>
        <ToggleRow label={t('rules_require_email')} value={settings.requireEmail ?? true} onChange={(v) => patch({ requireEmail: v })} />
      </Card>

      <SectionTitle>{t('rules_catalog_title')}</SectionTitle>
      <Card>
        <ToggleRow label={t('rules_hide_out_of_stock')} value={settings.hideOutOfStockInCatalog ?? false} onChange={(v) => patch({ hideOutOfStockInCatalog: v })} />
        <AppText variant="small" tone="muted">
          {settings.hideOutOfStockInCatalog ? t('rules_hide_out_of_stock_on') : t('rules_hide_out_of_stock_off')}
        </AppText>
      </Card>

      <SectionTitle>{t('rules_custom_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 6 }}>
        {t('rules_custom_hint')}
      </AppText>
      {fields.map((field, index) => (
        <Card key={index} style={{ marginBottom: 8 }}>
          <Field label={t('rules_custom_label')} value={field.label} onChangeText={(label) => patch({ customFields: fields.map((f, i) => (i === index ? { ...f, label, key: f.key } : f)) })} maxLength={60} />
          <ChipRow label={t('rules_custom_type')}>
            <Chip label={t('rules_custom_text')} selected={field.type === 'text'} onPress={() => patch({ customFields: fields.map((f, i) => (i === index ? { ...f, type: 'text' } : f)) })} />
            <Chip label={t('rules_custom_date')} selected={field.type === 'date'} onPress={() => patch({ customFields: fields.map((f, i) => (i === index ? { ...f, type: 'date' } : f)) })} />
          </ChipRow>
          <ToggleRow label={t('rules_custom_required')} value={field.required} onChange={(v) => patch({ customFields: fields.map((f, i) => (i === index ? { ...f, required: v } : f)) })} />
          <Button label={t('delete')} variant="danger" compact style={{ alignSelf: 'flex-start' }} onPress={() => patch({ customFields: fields.filter((_, i) => i !== index) })} />
        </Card>
      ))}
      <Button
        label={t('rules_custom_add')}
        icon="add"
        variant="secondary"
        compact
        disabled={fields.length >= 5}
        style={{ alignSelf: 'flex-start' }}
        onPress={() => patch({ customFields: [...fields, { key: freeKey(fields), label: '', type: 'text', required: false }] })}
      />

      <SectionTitle>{t('rules_hours_title')}</SectionTitle>
      <Card>
        <ToggleRow label={t('rules_hours_custom')} value={custom} onChange={setCustomHours} />
        <AppText variant="small" tone="muted">
          {custom ? t('rules_hours_custom_on') : t('rules_hours_custom_off')}
        </AppText>
      </Card>
      {custom ? (
        <View style={{ marginTop: 10 }}>
          <WeeklyBlocksEditor blocks={blocks} onChange={(next) => patch({ hoursBlocks: next })} />
        </View>
      ) : null}

      {save.error ? (
        <AppText tone="danger" style={{ marginTop: 10 }} accessibilityLiveRegion="polite">
          {save.error}
        </AppText>
      ) : null}
      <Button label={t('save_changes')} loading={save.busy} onPress={() => void submit()} style={{ marginTop: 16 }} />

      <SectionTitle>{t('rules_closures_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 8 }}>
        {t('rules_closures_hint')}
      </AppText>
      <Card>
        <CalendarPicker value={closureDate} onChange={setClosureDate} today={today} maxDate={addDays(today, 730)} />
        <View style={{ height: 10 }} />
        <Field label={t('rules_closure_reason')} value={closureReason} onChangeText={setClosureReason} maxLength={80} error={closuresAction.fields.reason} />
        {closuresAction.error ? (
          <AppText tone="danger" style={{ marginBottom: 8 }} accessibilityLiveRegion="polite">
            {closuresAction.error}
          </AppText>
        ) : null}
        <Button label={t('rules_closure_add', { date: formatDay(closureDate, language, { day: 'numeric', month: 'short' }) })} icon="add" compact loading={closuresAction.busy} onPress={() => void addClosure()} style={{ alignSelf: 'flex-start' }} />
      </Card>
      {(closures.data ?? []).length === 0 ? (
        <AppText tone="muted" style={{ marginTop: 8 }}>
          {t('rules_closures_empty')}
        </AppText>
      ) : (
        <View style={{ marginTop: 8, gap: 6 }}>
          {(closures.data ?? [])
            .filter((c) => c.date >= today)
            .map((closure) => (
              <View key={closure.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">
                    {upperFirst(formatDay(closure.date, language))}
                  </AppText>
                  {closure.reason ? (
                    <AppText variant="small" tone="muted">
                      {closure.reason}
                    </AppText>
                  ) : null}
                </View>
                <Pressable accessibilityRole="button" onPress={() => void removeClosure(closure.id)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <AppText tone="danger" variant="bodyStrong">
                    {t('delete')}
                  </AppText>
                </Pressable>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}
