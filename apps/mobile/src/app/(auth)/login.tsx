import { loginSchema } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { apiErrors, issuesToErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { setRememberSession } from '@/lib/storage';
import { AuthShell } from '@/ui/AuthShell';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { OrDivider } from '@/ui/OrDivider';
import { SocialButtons } from '@/ui/SocialButtons';
import { AppText } from '@/ui/Text';

export default function Login() {
  const router = useRouter();
  const { t, colors } = useSettings();
  const { signIn } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
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
      // Antes de iniciar sesión: define si el refresh token se guarda en el dispositivo o solo en memoria.
      setRememberSession(remember);
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
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: remember }} accessibilityLabel={t('remember_me')} onPress={() => setRemember((v) => !v)} style={styles.remember}>
        <View style={[styles.box, { borderColor: colors.gold, backgroundColor: remember ? colors.gold : 'transparent' }]}>{remember ? <Ionicons name="checkmark" size={16} color={colors.onGold} /> : null}</View>
        <AppText>{t('remember_me')}</AppText>
      </Pressable>
      {general ? (
        <AppText tone="danger" style={{ marginBottom: 12 }} accessibilityLiveRegion="polite">
          {general}
        </AppText>
      ) : null}
      <Button label={t('login')} onPress={submit} loading={busy} />
      <View style={{ height: 8 }} />
      <Button label={t('forgot_password')} variant="ghost" onPress={() => router.push('/recover')} />
      <OrDivider label={t('or_sign_in_with')} />
      <SocialButtons intent="signin" />
      <View style={{ height: 8 }} />
      <Button label={`${t('no_account')} ${t('create_account')}`} variant="ghost" onPress={() => router.replace('/register')} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  remember: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, marginBottom: 8 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
