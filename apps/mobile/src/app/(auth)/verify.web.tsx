/** Ruta /verify SOLO WEB (nativo: verify.tsx, sin cambios). Presentación en src/web/screens/Recovery.tsx. */
import { RECOVERY_CHANNELS, type RecoveryChannel } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { Brand } from '@/ui/Brand';
import { VerifyView } from '@/web/screens/Recovery';
import { setRecoveryIdentifier } from '@/web/services/recoveryContext';
import { useWebText } from '@/web/services/useWebText';

export default function VerifyWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { identifier = '', channel: rawChannel, devCode } = useLocalSearchParams<{ identifier?: string; channel?: string; devCode?: string }>();
  const channel: RecoveryChannel = RECOVERY_CHANNELS.find((c) => c === rawChannel) ?? 'email';

  return (
    <VerifyView
      t={t}
      language={language}
      logo={<Brand size={56} />}
      channel={channel}
      devCode={devCode}
      onVerify={async (code) => {
        try {
          const { resetToken } = await api.recoverVerify(identifier, code);
          setRecoveryIdentifier(identifier);
          router.replace({ pathname: '/reset', params: { token: resetToken } });
          return { ok: true };
        } catch (error) {
          const result = apiErrors(error, t);
          return { ok: false, fields: result.fields, general: result.general };
        }
      }}
      onResend={async () => {
        try {
          await api.recoverRequest(identifier, channel);
          return { ok: true };
        } catch (error) {
          return { ok: false, general: apiErrors(error, t).general };
        }
      }}
      onChangeMethod={() => router.replace('/recover')}
      onBack={() => router.replace('/login')}
    />
  );
}
