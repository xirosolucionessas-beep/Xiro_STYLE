import { loginSchema } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { apiErrors, issuesToErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { AuthShell } from '@/ui/AuthShell';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { SocialButtons } from '@/ui/SocialButtons';
import { AppText } from '@/ui/Text';

export default function Login() {
  const router = useRouter();
  const { t } = useSettings();
  const { signIn } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setGeneral(undefined);
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, t));
    setErrors({});
    setBusy(true);
    try {
      await signIn(await api.login({ identifier, password }));
    } catch (error) {
      const result = apiErrors(error, t);
      setErrors(result.fields);
      setGeneral(result.general);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('login')} subtitle={t('login_sub')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}>
      <SocialButtons intent="signin" />
      <Field
        label={t('identifier_label')}
        value={identifier}
        onChangeText={setIdentifier}
        error={errors.identifier}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="username"
        returnKeyType="next"
      />
      <Field
        label={t('password')}
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        password
        textContentType="password"
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {general ? (
        <AppText tone="danger" style={{ marginBottom: 12 }} accessibilityLiveRegion="polite">
          {general}
        </AppText>
      ) : null}
      <Button label={t('login')} onPress={submit} loading={busy} />
      <View style={{ height: 8 }} />
      <Button label={t('forgot_password')} variant="ghost" onPress={() => router.push('/recover')} />
      <Button label={`${t('no_account')} ${t('create_account')}`} variant="ghost" onPress={() => router.replace('/register')} />
    </AuthShell>
  );
}
