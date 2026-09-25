/**
 * Ruta /item/[id] SOLO WEB (nativo: item/[id].tsx, sin cambios). Ficha de inventario con los mismos datos y acciones
 * (editar, eliminar con confirmación). Presentación en src/web/screens/ItemDetail.tsx.
 */
import { formatMoney } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { api, errorKey, resolveMedia } from '@/lib/api';
import { useInvalidateCatalog, useItem } from '@/lib/queries';
import { margin } from '@/lib/sections';
import { useAuthed } from '@/lib/session';
import { useDialogs } from '@/ui/Dialogs';
import { EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { ItemDetailView } from '@/web/screens/ItemDetail';
import { useWebText } from '@/web/services/useWebText';
import type { KpiView } from '@/web/ui/Page';

const STATUS_TONE = { available: 'success', reorder: 'warning', out_of_stock: 'danger' } as const;

export default function InventoryDetailWeb() {
  const router = useRouter();
  const { t } = useWebText();
  const { business } = useAuthed();
  const { confirm, toast } = useDialogs();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item, isPending } = useItem(id);
  const invalidate = useInvalidateCatalog();
  const [busy, setBusy] = useState(false);

  if (isPending) {
    return (
      <Screen header={<Header title={t('item_details')} />}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen header={<Header title={t('item_details')} />}>
        <EmptyState icon="cube-outline" message={t('not_found')} />
      </Screen>
    );
  }

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
  const gain = margin(item.price, item.internalUnitCost);
  const kpis: KpiView[] = [
    { id: 'stock', icon: 'package', tone: STATUS_TONE[item.stockStatus], label: t('sec_id_kpi_stock'), value: t('sec_id_units', { n: item.stock }), hint: t(`status_${item.stockStatus}`) },
    { id: 'price', icon: 'coins', label: t('sec_id_kpi_price'), value: money(item.price) },
    { id: 'cost', icon: 'receipt', label: t('sec_id_kpi_cost'), value: money(item.internalUnitCost) },
    { id: 'margin', icon: 'trending-up', label: t('sec_id_kpi_margin'), value: gain ? `${gain.percent}%` : '—', hint: gain ? money(gain.amount) : undefined },
  ];

  return (
    <Screen header={<Header title={item.name} subtitle={item.categoryName} />}>
      <ItemDetailView
        t={t}
        name={item.name}
        photos={item.photos
          .slice(0, 4)
          .map((photo) => resolveMedia(photo.url))
          .filter((url): url is string => Boolean(url))}
        status={item.stockStatus}
        statusLabel={t(`status_${item.stockStatus}`)}
        description={item.description}
        kpis={kpis}
        rows={[
          { id: 'code', label: t('item_code'), value: item.referenceCode || '—' },
          { id: 'detail', label: t('item_detail'), value: item.detail || '—' },
        ]}
        notes={item.internalNotes}
        deleting={busy}
        onEdit={() => router.push({ pathname: '/item/form', params: { id: item.id } })}
        onDelete={() => void remove()}
      />
    </Screen>
  );
}
