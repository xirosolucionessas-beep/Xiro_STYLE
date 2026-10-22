import { BIRTHDAY_MAX_VALID_DAYS, birthdayProgramSchema, type BirthdayProgramDto, type BirthdayRewardKind, type BirthdayScope } from '@xiro/shared';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '@/lib/api';
import { apiErrors, toInt } from '@/lib/forms';
import { useBirthdayProgram, useInvalidateBirthdayProgram } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { CheckRow } from './CheckRow';
import { useDialogs } from './Dialogs';
import { Field } from './Field';
import { Card, Chip, ChipRow } from './Kit';
import { AppText } from './Text';

/** Configuración del programa de cumpleaños (Android/iOS). Solo el dueño la ve; el servidor lo vuelve a exigir. */
export function BirthdayProgramPanel() {
  const { t } = useSettings();
  const program = useBirthdayProgram();
  if (program.isLoading) return <ActivityIndicator accessibilityLabel={t('loading')} />;
  if (!program.data) return <Button label={t('retry')} variant="secondary" onPress={() => void program.refetch()} />;
  return <BirthdayProgramForm program={program.data} />;
}

function BirthdayProgramForm({ program }: { program: BirthdayProgramDto }) {
  const { t } = useSettings();
  const { toast } = useDialogs();
  const invalidate = useInvalidateBirthdayProgram();
  const [enabled, setEnabled] = useState(program.enabled);
  const [rewardKind, setRewardKind] = useState<BirthdayRewardKind>(program.rewardKind);
  const [rewardValue, setRewardValue] = useState(String(program.rewardValue));
  const [scope, setScope] = useState<BirthdayScope>(program.scope);
  const [validDays, setValidDays] = useState(String(program.validDays));
  const [minTotal, setMinTotal] = useState(String(program.minTotal));
  const [combinable, setCombinable] = useState(program.combinable);
  const [message, setMessage] = useState(program.message);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    const input = { enabled, rewardKind, rewardValue: toInt(rewardValue), scope, validDays: toInt(validDays), minTotal: toInt(minTotal), combinable, message: message.trim() };
    // Misma validación que el servidor (que la repite): el negocio ve el problema antes de enviar.
    const parsed = birthdayProgramSchema.safeParse(input);
    if (!parsed.success) return setError(t(parsed.error.issues[0]?.path[0] === 'rewardValue' ? 'reward_value_out_of_range' : 'validation_error'));
    setError(undefined);
    setBusy(true);
    try {
      await api.updateBirthdayProgram(parsed.data);
      await invalidate();
      toast(t('birthday_saved'));
    } catch (e) {
      const result = apiErrors(e, t);
      setError(result.general ?? Object.values(result.fields)[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <AppText tone="muted" style={{ marginBottom: 10 }}>
        {t('birthday_program_intro')}
      </AppText>
      <CheckRow label={t('birthday_enabled')} checked={enabled} onChange={setEnabled} />
      <AppText variant="label" tone="gold" style={{ marginTop: 12 }}>
        {t('birthday_reward_kind')}
      </AppText>
      <ChipRow label={t('birthday_reward_kind')}>
        <Chip label={t('birthday_kind_percent')} selected={rewardKind === 'percent'} onPress={() => setRewardKind('percent')} />
        <Chip label={t('birthday_kind_fixed')} selected={rewardKind === 'fixed'} onPress={() => setRewardKind('fixed')} />
      </ChipRow>
      <View style={{ height: 10 }} />
      <Field
        label={t('birthday_reward_value')}
        hint={t(rewardKind === 'percent' ? 'birthday_reward_value_hint_percent' : 'birthday_reward_value_hint_fixed')}
        value={rewardValue}
        onChangeText={setRewardValue}
        keyboardType="number-pad"
        maxLength={10}
      />
      <AppText variant="label" tone="gold">
        {t('birthday_scope')}
      </AppText>
      <ChipRow label={t('birthday_scope')}>
        {(['all', 'services', 'products'] as const).map((s) => (
          <Chip key={s} label={t(`birthday_scope_${s}`)} selected={scope === s} onPress={() => setScope(s)} />
        ))}
      </ChipRow>
      <View style={{ height: 10 }} />
      <Field label={t('birthday_valid_days')} hint={t('birthday_valid_days_hint')} value={validDays} onChangeText={setValidDays} keyboardType="number-pad" maxLength={String(BIRTHDAY_MAX_VALID_DAYS).length} />
      <Field label={t('birthday_min_total')} hint={t('birthday_min_total_hint')} value={minTotal} onChangeText={setMinTotal} keyboardType="number-pad" maxLength={10} />
      <CheckRow label={t('birthday_combinable')} hint={t('birthday_combinable_hint')} checked={combinable} onChange={setCombinable} />
      <View style={{ height: 10 }} />
      <Field label={t('birthday_message')} hint={t('birthday_message_hint')} value={message} onChangeText={setMessage} multiline maxLength={300} />
      <Card style={{ marginTop: 4 }}>
        <AppText variant="small">{t('birthday_rules', { days: toInt(validDays) || program.validDays })}</AppText>
      </Card>
      {error ? (
        <AppText tone="danger" style={{ marginTop: 10 }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      <View style={{ height: 14 }} />
      <Button label={t('save_changes')} onPress={() => void save()} loading={busy} />
    </View>
  );
}
