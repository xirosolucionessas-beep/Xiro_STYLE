/** Ruta /recover SOLO WEB (nativo: recover.tsx, sin cambios). Presentación en src/web/screens/Recovery.tsx. */
import type { RecoveryChannel } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { Brand } from '@/ui/Brand';
import { RecoverView } from '@/web/screens/Recovery';
import { setRecoveryIdentifier } from '@/web/services/recoveryContext';
import { useWebText } from '@/web/services/useWebText';

export default function RecoverWeb() {
  const router = useRouter();
  const { t, language } = useWebText();

  const onSubmit = useCallback(
    async ({ identifier, channel }: { identifier: string; channel: RecoveryChannel }) => {
      try {
        const response = await api.recoverRequest(identifier, channel);
        setRecoveryIdentifier(identifier);
        router.push({ pathname: '/verify', params: { identifier, channel, ...(response.devCode ? { devCode: response.devCode } : {}) } });
        return { ok: true };
      } catch (error) {
        const result = apiErrors(error, t);
        return { ok: false, fields: result.fields, general: result.general };
      }
    },
    [router, t],
  );

  return <RecoverView t={t} language={language} logo={<Brand size={56} />} onSubmit={onSubmit} onBack={() => router.replace('/login')} />;
}
