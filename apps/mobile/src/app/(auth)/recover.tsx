import { identifierSchema, RECOVERY_CHANNELS, type RecoveryChannel } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useSettings } from '@/lib/settings';
import { AuthShell } from '@/ui/AuthShell';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Chip, ChipRow } from '@/ui/Kit';
import { AppText } from '@/ui/Text';

export default function Recover() {
  const router = useRouter();
  const { t } = useSettings();
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState<RecoveryChannel>('email');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setGeneral(undefined);
    const parsed = identifierSchema.safeParse(identifier);
    if (!parsed.success) return setErrors({ identifier: t('identifier_invalid') });
    setErrors({});
    setBusy(true);
    try {
      const response = await api.recoverRequest(identifier, channel);
      router.push({ pathname: '/verify', params: { identifier, ...(response.devCode ? { devCode: response.devCode } : {}) } });
    } catch (error) {
      const result = apiErrors(error, t);
      setErrors(result.fields);
      setGeneral(result.general);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('recover_title')} subtitle={t('recover_sub')}>
      <Field label={t('identifier_label')} value={identifier} onChangeText={setIdentifier} error={errors.identifier} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
      <ChipRow label={t('recover_channel')}>
        {RECOVERY_CHANNELS.map((option) => (
          <Chip key={option} label={t(`channel_${option}`)} selected={channel === option} onPress={() => setChannel(option)} />
        ))}
      </ChipRow>
      {general ? (
        <AppText tone="danger" style={{ marginTop: 12 }}>
          {general}
        </AppText>
      ) : null}
      <Button label={t('send_code')} onPress={submit} loading={busy} style={{ marginTop: 22 }} />
    </AuthShell>
  );
}
