import { whatsappLink } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { useClient, useInvalidateClients } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Card, EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <AppText variant="label" tone="gold">
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ marginTop: 2 }}>
        {value || '—'}
      </AppText>
    </View>
  );
}

export default function ClientDetail() {
  const router = useRouter();
  const { t } = useSettings();
  const { confirm, toast } = useDialogs();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: client, isPending } = useClient(id);
  const invalidate = useInvalidateClients();
  const [busy, setBusy] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);

  if (isPending) return <Screen header={<Header title={t('clients')} />}><ActivityIndicator style={{ marginTop: 40 }} /></Screen>;
  if (!client) return <Screen header={<Header title={t('clients')} />}><EmptyState icon="people-outline" message={t('not_found')} /></Screen>;

  async function remove() {
    if (!client) return;
    if (!(await confirm({ title: t('confirm_delete_title'), message: `${client.name}. ${t('confirm_delete_body')}`, confirmLabel: t('delete'), destructive: true }))) return;
    setBusy(true);
    try {
      await api.deleteClient(client.id);
      await invalidate();
      router.back();
    } catch (error) {
      toast(t(errorKey(error)));
      setBusy(false);
    }
  }

  async function anonymize() {
    if (!client) return;
    if (!(await confirm({ title: t('client_anonymize_confirm_title'), message: t('client_anonymize_confirm_text'), confirmLabel: t('client_anonymize'), destructive: true }))) return;
    setAnonymizing(true);
    try {
      await api.anonymizeClient(client.id);
      await invalidate();
      toast(t('client_anonymized'));
    } catch (error) {
      toast(t(errorKey(error)));
    } finally {
      setAnonymizing(false);
    }
  }

  return (
    <Screen header={<Header title={client.name} />}>
      <Card>
        <Detail label={t('phone')} value={client.phone ? `+${client.phone}` : ''} />
        <Detail label={t('email')} value={client.email ?? ''} />
        <Detail label={t('address')} value={client.address} />
        <Detail label={t('client_notes')} value={client.notes} />
      </Card>
      {client.phone ? (
        <>
          <Button label="WhatsApp" icon="logo-whatsapp" onPress={() => void Linking.openURL(whatsappLink(client.phone!, ''))} style={{ marginTop: 18 }} />
          <Button label={t('call')} icon="call-outline" variant="secondary" onPress={() => void Linking.openURL(`tel:+${client.phone}`)} style={{ marginTop: 10 }} />
        </>
      ) : null}
      <Button label={t('edit')} icon="create-outline" variant="secondary" onPress={() => router.push({ pathname: '/client/form', params: { id: client.id } })} style={{ marginTop: 10 }} />
      <Button label={t('client_anonymize')} icon="eye-off-outline" variant="secondary" loading={anonymizing} onPress={anonymize} style={{ marginTop: 10 }} />
      <Button label={t('delete')} icon="trash-outline" variant="danger" loading={busy} onPress={remove} style={{ marginTop: 10 }} />
    </Screen>
  );
}
