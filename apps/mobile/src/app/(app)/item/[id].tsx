import { formatMoney } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { useInvalidateCatalog, useItem } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Gallery } from '@/ui/Gallery';
import { Card, EmptyState, StatusPill } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

function Detail({ label, value, tone }: { label: string; value: string; tone?: 'gold' }) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <AppText variant="label" tone="gold">
        {label}
      </AppText>
      <AppText variant="bodyStrong" tone={tone === 'gold' ? 'gold' : 'text'} style={{ marginTop: 2 }}>
        {value}
      </AppText>
    </View>
  );
}

export default function InventoryDetail() {
  const router = useRouter();
  const { t } = useSettings();
  const { business } = useAuthed();
  const { confirm, toast } = useDialogs();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item, isPending } = useItem(id);
  const invalidate = useInvalidateCatalog();
  const [busy, setBusy] = useState(false);

  if (isPending) return <Screen header={<Header title={t('item_details')} />}><ActivityIndicator style={{ marginTop: 40 }} /></Screen>;
  if (!item) return <Screen header={<Header title={t('item_details')} />}><EmptyState icon="cube-outline" message={t('not_found')} /></Screen>;

  async function remove() {
    if (!item) return;
    if (!(await confirm({ title: t('confirm_delete_title'), message: `${item.name}. ${t('confirm_delete_body')}`, confirmLabel: t('delete'), destructive: true }))) return;
    setBusy(true);
    try {
      await api.deleteItem(item.id);
      await invalidate();
      router.back();
    } catch (error) {
      toast(t(errorKey(error)));
      setBusy(false);
    }
  }

  const money = (value: number) => (value ? formatMoney(value, business.currency) : '—');

  return (
    <Screen header={<Header title={t('item_details')} />}>
      <Gallery urls={item.photos.map((p) => p.url)} icon="cube-outline" />
      <AppText variant="title" style={{ marginTop: 20 }}>
        {item.name}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <AppText tone="gold" variant="bodyStrong">
          {item.categoryName}
        </AppText>
        <StatusPill status={item.stockStatus} />
      </View>
      {item.description ? (
        <AppText tone="muted" style={{ marginTop: 14 }}>
          {item.description}
        </AppText>
      ) : null}

      <Card style={{ marginTop: 16 }}>
        <Detail label={t('item_code')} value={item.referenceCode || '—'} />
        <Detail label={t('item_detail')} value={item.detail || '—'} />
        <Detail label={t('item_cost')} value={money(item.internalUnitCost)} tone="gold" />
        <Detail label={t('item_price')} value={money(item.price)} />
        <Detail label={t('stock_quantity')} value={`${item.stock} ${t('units')}`} />
        {item.internalNotes ? <Detail label={t('item_notes')} value={item.internalNotes} /> : null}
      </Card>

      <Button label={t('item_edit')} icon="create-outline" onPress={() => router.push({ pathname: '/item/form', params: { id: item.id } })} style={{ marginTop: 20 }} />
      <Button label={t('delete')} variant="danger" icon="trash-outline" loading={busy} onPress={remove} style={{ marginTop: 10 }} />
    </Screen>
  );
}
