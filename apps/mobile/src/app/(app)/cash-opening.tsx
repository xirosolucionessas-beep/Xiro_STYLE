import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors, toInt } from '@/lib/forms';
import { keys, useCashToday } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function CashOpening() {
  const router = useRouter();
  const { t } = useSettings();
  const { business } = useAuthed();
  const queryClient = useQueryClient();
  const current = useCashToday().data?.opening;
  const [amount, setAmount] = useState(current ? String(current.amount) : '');
  const [note, setNote] = useState(current?.note ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api.openCash({ amount: toInt(amount), note });
      await queryClient.invalidateQueries({ queryKey: keys.cash });
      // El flujo de caja del Inicio pasa a "caja abierta" con su base.
      await queryClient.invalidateQueries({ queryKey: keys.cashCloseSummary });
      close();
    } catch (e) {
      const result = apiErrors(e, t);
      setError(result.general ?? Object.values(result.fields)[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<Header title={t('cash_opening_title')} onBack={close} />}>
      <AppText tone="muted" style={{ marginBottom: 18 }}>
        {t('cash_opening_question')}
      </AppText>
      <Field label={t('opening_amount')} value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" prefix={business.currency} />
      <Field label={t('optional_note')} value={note} onChangeText={setNote} maxLength={200} />
      {error ? (
        <AppText tone="danger" style={{ marginBottom: 12 }}>
          {error}
        </AppText>
      ) : null}
      <Button label={t('start_day')} onPress={submit} loading={busy} />
      <Button label={t('skip_today')} variant="ghost" onPress={close} style={{ marginTop: 8 }} />
    </Screen>
  );
}
