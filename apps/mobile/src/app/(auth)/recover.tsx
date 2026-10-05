import { identifierSchema, RECOVERY_CHANNELS, type RecoveryChannel } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { filterPhoneInput, identifierErrorKeyForChannel, isValidIdentifierForChannel } from '@/lib/recovery';
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
  const isPhoneChannel = channel === 'whatsapp' || channel === 'sms';
  const isValid = isValidIdentifierForChannel(identifier, channel);

  // El canal lo elige la persona: cambiarlo limpia el campo y cualquier error, porque un celular y un correo no
  // comparten formato ni son intercambiables entre sí.
  function chooseChannel(next: RecoveryChannel) {
    setChannel(next);
    setIdentifier('');
    setErrors({});
    setGeneral(undefined);
  }

  function onIdentifier(value: string) {
    setIdentifier(isPhoneChannel ? filterPhoneInput(value) : value);
    if (errors.identifier) setErrors({});
  }

  async function submit() {
    setGeneral(undefined);
    if (!isValidIdentifierForChannel(identifier, channel)) return setErrors({ identifier: t(identifierErrorKeyForChannel(channel)) });
    // Segunda pasada con el esquema completo, igual que el servidor: el envío nunca depende solo del chequeo del cliente.
    const parsed = identifierSchema.safeParse(identifier);
    if (!parsed.success) return setErrors({ identifier: t(identifierErrorKeyForChannel(channel)) });
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
      <ChipRow label={t('recover_channel')}>
        {RECOVERY_CHANNELS.map((option) => (
          <Chip key={option} label={t(`channel_${option}`)} selected={channel === option} onPress={() => chooseChannel(option)} />
        ))}
      </ChipRow>
      {isPhoneChannel ? (
        <Field label={t('identifier_label')} value={identifier} onChangeText={onIdentifier} error={errors.identifier} keyboardType="phone-pad" maxLength={13} autoComplete="tel" />
      ) : (
        <Field label={t('identifier_label')} value={identifier} onChangeText={onIdentifier} error={errors.identifier} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="username" />
      )}
      {general ? (
        <AppText tone="danger" style={{ marginTop: 12 }}>
          {general}
        </AppText>
      ) : null}
      <Button label={t('send_code')} onPress={submit} loading={busy} disabled={!isValid} style={{ marginTop: 22 }} />
    </AuthShell>
  );
}
