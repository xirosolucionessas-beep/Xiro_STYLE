/** Ruta /reset SOLO WEB (nativo: reset.tsx, sin cambios). Presentación en src/web/screens/Recovery.tsx. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { Brand } from '@/ui/Brand';
import { useDialogs } from '@/ui/Dialogs';
import { ResetView } from '@/web/screens/Recovery';
import { takeRecoveryIdentifier } from '@/web/services/recoveryContext';
import { useWebText } from '@/web/services/useWebText';

export default function ResetWeb() {
  const router = useRouter();
  const { signIn } = useSession();
  const { toast } = useDialogs();
  const { t, language } = useWebText();
  const { token = '' } = useLocalSearchParams<{ token?: string }>();

  // Sin token válido en la URL no hay nada que restablecer: se vuelve a pedir el código.
  useEffect(() => {
    if (!token) router.replace('/recover');
  }, [token, router]);

  return (
    <ResetView
      t={t}
      language={language}
      logo={<Brand size={56} />}
      onBack={() => router.replace('/login')}
      onSubmit={async ({ password }) => {
        try {
          await api.recoverReset(token, password);
        } catch (error) {
          const result = apiErrors(error, t);
          return { ok: false, fields: result.fields, general: result.general };
        }
        // "Guardar y entrar": con la contraseña nueva se inicia sesión con los endpoints de siempre; si algo falla, se pide iniciar sesión.
        const identifier = takeRecoveryIdentifier();
        if (identifier) {
          try {
            await signIn(await api.login({ identifier, password }));
            return { ok: true };
          } catch {
            /* cae al inicio de sesión normal */
          }
        }
        toast(t('reset_done'));
        router.replace('/login');
        return { ok: true };
      }}
    />
  );
}
