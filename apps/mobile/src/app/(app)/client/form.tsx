import { clientInputSchema } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors, issuesToErrors } from '@/lib/forms';
import { useClient, useInvalidateClients } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function ClientForm() {
  const router = useRouter();
  const { t } = useSettings();
  const { toast } = useDialogs();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useClient(id).data;
  const invalidate = useInvalidateClients();
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!existing || hydrated.current) return;
    hydrated.current = true;
    setForm({ name: existing.name, email: existing.email ?? '', phone: existing.phone ?? '', address: existing.address, notes: existing.notes });
  }, [existing]);

  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    setGeneral(undefined);
    const parsed = clientInputSchema.safeParse(form);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, t));
    setErrors({});
    setBusy(true);
    try {
      if (id) await api.updateClient(id, form);
      else await api.createClient(form);
      await invalidate();
      toast(id ? t('saved') : t('client_created'));
      router.back();
    } catch (error) {
      const result = apiErrors(error, t);
      setErrors(result.fields);
      setGeneral(result.general);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<Header title={id ? t('client_edit') : t('client_new')} />}>
      <Field label={`${t('full_name')} *`} value={form.name} onChangeText={set('name')} error={errors.name} maxLength={80} />
      <Field label={t('phone')} value={form.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" prefix="+57" />
      <Field label={t('email')} value={form.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" />
      <Field label={t('address')} value={form.address} onChangeText={set('address')} maxLength={160} />
      <Field label={t('client_notes')} value={form.notes} onChangeText={set('notes')} multiline maxLength={1000} />
      {general ? (
        <AppText tone="danger" style={{ marginBottom: 12 }}>
          {general}
        </AppText>
      ) : null}
      <Button label={id ? t('save_changes') : t('save')} onPress={submit} loading={busy} />
    </Screen>
  );
}
