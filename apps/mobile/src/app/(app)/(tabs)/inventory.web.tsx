/**
 * Ruta /inventory SOLO WEB (nativo: inventory.tsx). Mismos datos y acciones (filtros, agregar, categorías, apertura
 * desde una alerta con ?status=). Tabla paginada por cursor ("Cargar más") con los filtros en el servidor; conteos y
 * valor de `/items/summary`. La presentación está en src/web/screens/Inventory.tsx.
 */
import { formatMoney, STOCK_STATUSES, type Currency, type StockStatus } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { actorOf, meets } from '@/lib/access';
import { api, errorKey, resolveMedia } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { flatPages, useCategories, useInvalidateCatalog, useItemsPages, useItemsSummary } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useDialogs } from '@/ui/Dialogs';
import { Header, Screen } from '@/ui/Screen';
import { Ico } from '@/web/icons';
import { InventoryView, type InventoryRowView } from '@/web/screens/Inventory';
import { useWebText } from '@/web/services/useWebText';
import { Button } from '@/web/ui/Button';
import type { KpiView } from '@/web/ui/Page';

const STATUS_TONE = { available: 'success', reorder: 'warning', out_of_stock: 'danger' } as const;
const STATUS_ICON = { available: 'circle-check', reorder: 'triangle-alert', out_of_stock: 'x' } as const;

export default function InventoryWeb() {
  const router = useRouter();
  const { t } = useWebText();
  const { user, business } = useAuthed();
  const canManage = meets(actorOf(user), ['catalog_manage']);
  const { toast } = useDialogs();
  const invalidateCatalog = useInvalidateCatalog();
  const categories = useCategories();
  const currency = business.currency as Currency;
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const params = useLocalSearchParams<{ status?: string }>();
  const fromLink = (STOCK_STATUSES as readonly string[]).includes(params.status ?? '') ? (params.status as StockStatus) : null;
  // El filtro elegido a mano manda hasta que llega OTRO enlace de alerta (entonces vuelve a mandar el enlace).
  const [picked, setPicked] = useState<{ value: StockStatus | null; link: StockStatus | null } | null>(null);
  const status = picked && picked.link === fromLink ? picked.value : fromLink;

  // Inventario = lo que lleva existencias (productos y lo aún sin clasificar); filtros aplicados en el servidor.
  const items = useItemsPages({ tracked: true, categoryId: category ?? undefined, stockStatus: status ?? undefined });
  const stats = useItemsSummary();
  const stock = stats.data?.stock;
  const counts: Record<StockStatus, number | undefined> = { available: stock?.available, reorder: stock?.reorder, out_of_stock: stock?.outOfStock };
  const value = stats.data?.inventoryValue ?? null;
  const rows = useMemo<InventoryRowView[]>(
    () =>
      flatPages(items.data).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.categoryName,
          stock: item.stock,
          status: item.stockStatus,
          statusLabel: t(`status_${item.stockStatus}`),
          cost: item.internalUnitCost ? formatMoney(item.internalUnitCost, currency) : '—',
          photo: resolveMedia(item.photos[0]?.url) ?? null,
          href: `/item/${item.id}`,
          published: item.published,
        })),
    [items.data, currency, t],
  );

  async function publish(ids: string[], published: boolean) {
    setBulkBusy(true);
    try {
      await api.bulkPublish(ids, published);
      await invalidateCatalog();
      setSelected((prev) => prev.filter((id) => !ids.includes(id)));
    } catch (error) {
      toast(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setBulkBusy(false);
    }
  }

  const kpis: KpiView[] = [
    { id: 'total', icon: 'package', label: t('sec_kpi_inv_total'), value: stock ? String(stock.total) : '—', loading: stats.isLoading },
    ...STOCK_STATUSES.map((s) => ({ id: s, icon: STATUS_ICON[s], tone: STATUS_TONE[s], label: t(`status_${s}`), value: counts[s] !== undefined ? String(counts[s]) : '—', loading: stats.isLoading })),
    { id: 'value', icon: 'coins' as const, label: t('sec_kpi_inv_value'), value: value === null ? '—' : formatMoney(value, currency), loading: stats.isLoading },
  ];

  const add = () => router.push('/item/form');
  return (
    <Screen
      header={
        <Header
          root
          title={t('inventory')}
          subtitle={t('inventory_sub')}
          right={
            <>
              {canManage ? (
                <Button variant="secondary" icon={<Ico name="tag" size={18} />} onPress={() => router.push('/categories')}>
                  {t('categories')}
                </Button>
              ) : null}
              {canManage ? (
                <Button icon={<Ico name="plus" size={18} />} onPress={add}>
                  {t('add_to_inventory')}
                </Button>
              ) : null}
            </>
          }
        />
      }>
      <InventoryView
        t={t}
        kpis={kpis}
        categories={(categories.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
        category={category}
        onCategory={setCategory}
        statuses={STOCK_STATUSES.map((s) => ({ id: s, label: t(`status_${s}`) }))}
        status={status}
        onStatus={(id) => setPicked({ value: id as StockStatus | null, link: fromLink })}
        rows={rows}
        state={items.isPending ? 'loading' : items.isError ? 'error' : 'ready'}
        errorMessage={items.isError ? t(errorKey(items.error)) : undefined}
        onRetry={() => void items.refetch()}
        emptyAction={
          canManage ? (
            <Button icon={<Ico name="plus" size={18} />} onPress={add}>
              {t('add_to_inventory')}
            </Button>
          ) : undefined
        }
        navigate={(href) => router.push(href as never)}
        pagination={{
          hasMore: Boolean(items.hasNextPage),
          loading: items.isFetchingNextPage,
          error: items.isFetchNextPageError ? t(errorKey(items.error)) : undefined,
          onLoadMore: () => void items.fetchNextPage(),
        }}
        canPublish={canManage}
        selected={selected}
        onToggleSelect={(id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
        onSelectAll={setSelected}
        onQuickPublish={(id, published) => void publish([id], published)}
        onBulkPublish={(published) => void publish(selected, published)}
        bulkBusy={bulkBusy}
      />
    </Screen>
  );
}
