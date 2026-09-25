/**
 * Ruta /inventory SOLO WEB (nativo: inventory.tsx, sin cambios). Mismos datos y acciones (filtros, agregar, categorías,
 * apertura desde una alerta con ?status=); la presentación está en src/web/screens/Inventory.tsx.
 */
import { formatMoney, STOCK_STATUSES, summarizeStock, type Currency, type StockStatus } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { actorOf, meets } from '@/lib/access';
import { errorKey, resolveMedia } from '@/lib/api';
import { inventoryValue } from '@/lib/sections';
import { useCategories, useItems } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
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
  const items = useItems();
  const categories = useCategories();
  const currency = business.currency as Currency;
  const [category, setCategory] = useState<string | null>(null);
  const params = useLocalSearchParams<{ status?: string }>();
  const fromLink = (STOCK_STATUSES as readonly string[]).includes(params.status ?? '') ? (params.status as StockStatus) : null;
  // El filtro elegido a mano manda hasta que llega OTRO enlace de alerta (entonces vuelve a mandar el enlace).
  const [picked, setPicked] = useState<{ value: StockStatus | null; link: StockStatus | null } | null>(null);
  const status = picked && picked.link === fromLink ? picked.value : fromLink;

  const all = useMemo(() => items.data ?? [], [items.data]);
  const summary = useMemo(() => summarizeStock(all), [all]);
  const value = useMemo(() => inventoryValue(all), [all]);
  const rows = useMemo<InventoryRowView[]>(
    () =>
      all
        .filter((item) => (!category || item.categoryId === category) && (!status || item.stockStatus === status))
        .map((item) => ({
          id: item.id,
          name: item.name,
          category: item.categoryName,
          stock: item.stock,
          status: item.stockStatus,
          statusLabel: t(`status_${item.stockStatus}`),
          cost: item.internalUnitCost ? formatMoney(item.internalUnitCost, currency) : '—',
          photo: resolveMedia(item.photos[0]?.url) ?? null,
          href: `/item/${item.id}`,
        })),
    [all, category, status, currency, t],
  );

  const kpis: KpiView[] = [
    { id: 'total', icon: 'package', label: t('sec_kpi_inv_total'), value: items.data ? String(summary.total) : '—', loading: items.isLoading },
    ...STOCK_STATUSES.map((s) => ({ id: s, icon: STATUS_ICON[s], tone: STATUS_TONE[s], label: t(`status_${s}`), value: items.data ? String(summary[s]) : '—', loading: items.isLoading })),
    { id: 'value', icon: 'coins' as const, label: t('sec_kpi_inv_value'), value: value === null ? '—' : formatMoney(value, currency), loading: items.isLoading },
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
      />
    </Screen>
  );
}
