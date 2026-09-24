import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useSettings } from '@/lib/settings';
import { AuthShell } from '@/ui/AuthShell';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { AppText } from '@/ui/Text';

export default function Verify() {
  const router = useRouter();
  const { t } = useSettings();
  const { identifier = '', devCode } = useLocalSearchParams<{ identifier?: string; devCode?: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!/^\d{6}$/.test(code)) return setError(t('code_invalid'));
    setError(undefined);
    setBusy(true);
    try {
      const { resetToken } = await api.recoverVerify(identifier, code);
      router.replace({ pathname: '/reset', params: { token: resetToken } });
    } catch (e) {
      const result = apiErrors(e, t);
      setError(result.fields.code ?? result.general);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('verify_title')} subtitle={t('verify_sub')}>
      <AppText tone="muted" variant="small" style={{ marginBottom: 12 }}>
        {t('recover_sent')}
      </AppText>
      {devCode ? (
        <AppText tone="gold" variant="bodyStrong" style={{ marginBottom: 12 }}>
          DEV: {devCode}
        </AppText>
      ) : null}
      <Field
        label={t('verification_code')}
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
        error={error}
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        onSubmitEditing={submit}
      />
      <Button label={t('verify_code')} onPress={submit} loading={busy} />
    </AuthShell>
  );
}
