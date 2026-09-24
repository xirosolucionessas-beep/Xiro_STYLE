/** Ruta /login SOLO WEB (Android/iOS siguen con login.tsx, que no se toca). La presentación vive en src/web/screens/Login.tsx. */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { setRememberSession } from '@/lib/storage.web';
import { Brand } from '@/ui/Brand';
import { LoginView } from '@/web/screens/Login';
import { setSocialSeed } from '@/web/services/socialSeed';
import { useSocialAuth } from '@/web/services/useSocialAuth';
import { useWebText } from '@/web/services/useWebText';

export default function LoginWeb() {
  const router = useRouter();
  const { signIn } = useSession();
  const { t, language } = useWebText();
  const { state, start } = useSocialAuth(t, 'signin');

  const onSubmit = useCallback(
    async ({ identifier, password, remember }: { identifier: string; password: string; remember: boolean }) => {
      try {
        setRememberSession(remember);
        await signIn(await api.login({ identifier, password }));
        return { ok: true };
      } catch (error) {
        const result = apiErrors(error, t);
        return { ok: false, fields: result.fields, general: result.general };
      }
    },
    [signIn, t],
  );

  return (
    <LoginView
      t={t}
      language={language}
      logo={<Brand size={56} />}
      onSubmit={onSubmit}
      onRecover={() => router.push('/recover')}
      onRegister={() => router.replace('/register')}
      onBack={() => router.replace('/welcome')}
      social={state}
      onSocial={(provider) => void start(provider)}
      onCreateFromSocial={() => {
        if (state.notFound) setSocialSeed({ provider: state.notFound.provider, profile: state.notFound.profile });
        router.push('/register');
      }}
    />
  );
}
