import { passwordSchema } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useSettings } from '@/lib/settings';
import { AuthShell } from '@/ui/AuthShell';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { AppText } from '@/ui/Text';

export default function Reset() {
  const router = useRouter();
  const { t } = useSettings();
  const { toast } = useDialogs();
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setGeneral(undefined);
    const found: Record<string, string> = {};
    if (!passwordSchema.safeParse(password).success) found.password = t('password_weak');
    if (confirm !== password) found.confirm = t('passwords_mismatch');
    if (Object.keys(found).length > 0) return setErrors(found);
    setErrors({});
    setBusy(true);
    try {
      await api.recoverReset(token, password);
      toast(t('reset_done'));
      router.replace('/login');
    } catch (error) {
      const result = apiErrors(error, t);
      setErrors(result.fields);
      setGeneral(result.general);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('reset_title')} subtitle={t('reset_sub')} hideBack>
      <Field label={t('password')} value={password} onChangeText={setPassword} error={errors.password ?? errors.newPassword} hint={t('password_hint')} password textContentType="newPassword" />
      <Field label={t('confirm_password')} value={confirm} onChangeText={setConfirm} error={errors.confirm} password textContentType="newPassword" onSubmitEditing={submit} />
      {general ? (
        <AppText tone="danger" style={{ marginBottom: 12 }}>
          {general}
        </AppText>
      ) : null}
      <Button label={t('save')} onPress={submit} loading={busy} />
    </AuthShell>
  );
}
