/**
 * Ruta /cash-opening SOLO WEB (nativo: cash-opening.tsx, sin cambios). Acceso directo (URL, back/forward del navegador)
 * al mismo modal "Base inicial del día" que abre la tarjeta de balance en Inicio. Presentación en src/web/ui/CashOpeningModal.tsx.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { keys, useCashToday } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { useWebText } from '@/web/services/useWebText';
import { CashOpeningModal } from '@/web/ui/CashOpeningModal';

export default function CashOpeningWeb() {
  const router = useRouter();
  const { t } = useWebText();
  const { business } = useAuthed();
  const queryClient = useQueryClient();
  const cash = useCashToday();
  const opening = cash.data?.opening;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function submit(input: { amount: number; note: string }) {
    try {
      await api.openCash(input);
      await queryClient.invalidateQueries({ queryKey: keys.cash });
      close();
      return { ok: true };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false, general: result.general ?? Object.values(result.fields)[0] };
    }
  }

  return (
    <Screen header={<Header title={t('cash_opening_title')} onBack={close} />}>
      <CashOpeningModal open currentAmount={opening?.amount ?? 0} currency={business.currency} t={t} onSubmit={submit} onSkip={close} onClose={close} />
    </Screen>
  );
}
