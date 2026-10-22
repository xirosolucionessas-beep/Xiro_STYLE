import { BIRTHDAY_MAX_VALID_DAYS, birthdayProgramSchema, type BirthdayProgramDto, type BirthdayProgramInput, type BirthdayRewardKind, type BirthdayScope } from '@xiro/shared';
import { useState } from 'react';
import { Ico } from '../icons';
import { Button, Input, Select } from '../ui';
import { Checkbox, FormMessage } from '../ui/auth';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface BirthdayProgramViewProps {
  t: T;
  program: BirthdayProgramDto;
  onSave: (input: BirthdayProgramInput) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number.parseInt(v.trim(), 10) : Number.NaN);

/** Configuración del programa de cumpleaños (web). Valida con el mismo esquema que el servidor, que la repite. */
export function BirthdayProgramView({ t, program, onSave }: BirthdayProgramViewProps) {
  useWebStyles();
  const [enabled, setEnabled] = useState(program.enabled);
  const [rewardKind, setRewardKind] = useState<BirthdayRewardKind>(program.rewardKind);
  const [rewardValue, setRewardValue] = useState(String(program.rewardValue));
  const [scope, setScope] = useState<BirthdayScope>(program.scope);
  const [validDays, setValidDays] = useState(String(program.validDays));
  const [minTotal, setMinTotal] = useState(String(program.minTotal));
  const [combinable, setCombinable] = useState(program.combinable);
  const [message, setMessage] = useState(program.message);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setSaved(false);
    const parsed = birthdayProgramSchema.safeParse({ enabled, rewardKind, rewardValue: int(rewardValue), scope, validDays: int(validDays), minTotal: int(minTotal), combinable, message: message.trim() });
    if (!parsed.success) return setError(t(parsed.error.issues[0]?.path[0] === 'rewardValue' ? 'reward_value_out_of_range' : 'validation_error'));
    setError(undefined);
    setBusy(true);
    try {
      const result = await onSave(parsed.data);
      if (result.ok) setSaved(true);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  const days = int(validDays);
  return (
    <section className="xw-card" aria-labelledby="xw-birthday-program-title" style={{ marginTop: 'var(--xw-space-4)', display: 'grid', gap: 'var(--xw-space-2)' }}>
      <h2 id="xw-birthday-program-title" className="xw-label" style={{ margin: 0 }}>
        {t('birthday_program_title')}
      </h2>
      <p className="xw-hint" style={{ margin: 0 }}>
        {t('birthday_program_intro')}
      </p>
      <Checkbox checked={enabled} onChange={setEnabled}>
        {t('birthday_enabled')}
      </Checkbox>
      <Select
        label={t('birthday_reward_kind')}
        value={rewardKind}
        onChange={(v) => setRewardKind(v as BirthdayRewardKind)}
        options={[
          { value: 'percent', label: t('birthday_kind_percent') },
          { value: 'fixed', label: t('birthday_kind_fixed') },
        ]}
      />
      <Input label={t('birthday_reward_value')} hint={t(rewardKind === 'percent' ? 'birthday_reward_value_hint_percent' : 'birthday_reward_value_hint_fixed')} value={rewardValue} onChange={setRewardValue} inputMode="numeric" name="rewardValue" />
      <Select label={t('birthday_scope')} value={scope} onChange={(v) => setScope(v as BirthdayScope)} options={(['all', 'services', 'products'] as const).map((s) => ({ value: s, label: t(`birthday_scope_${s}`) }))} />
      <Input label={t('birthday_valid_days')} hint={t('birthday_valid_days_hint')} value={validDays} onChange={setValidDays} inputMode="numeric" maxLength={String(BIRTHDAY_MAX_VALID_DAYS).length} name="validDays" />
      <Input label={t('birthday_min_total')} hint={t('birthday_min_total_hint')} value={minTotal} onChange={setMinTotal} inputMode="numeric" name="minTotal" />
      <Checkbox checked={combinable} onChange={setCombinable}>
        {t('birthday_combinable')}
      </Checkbox>
      <p className="xw-hint" style={{ marginTop: 0 }}>
        {t('birthday_combinable_hint')}
      </p>
      <Input label={t('birthday_message')} hint={t('birthday_message_hint')} value={message} onChange={setMessage} multiline rows={2} maxLength={300} name="birthdayMessage" />
      <p className="xw-note">{t('birthday_rules', { days: Number.isNaN(days) ? program.validDays : days })}</p>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button onPress={() => void save()} loading={busy} loadingLabel={t('loading')}>
        {t('save_changes')}
      </Button>
      {saved ? (
        <p className="xw-note" role="status">
          <Ico name="check" size={16} />
          <span>{t('birthday_saved')}</span>
        </p>
      ) : null}
    </section>
  );
}
