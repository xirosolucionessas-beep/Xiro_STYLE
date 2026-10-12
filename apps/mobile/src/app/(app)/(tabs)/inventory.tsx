import { STOCK_STATUSES, type StockStatus } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { errorKey } from '@/lib/api';
import { flatPages, useCategories, useItemsPages, useItemsSummary } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { InventoryCard, ItemFlatGrid } from '@/ui/ItemCards';
import { Card, Chip, ChipRow, EmptyState, stockColor } from '@/ui/Kit';
import { PagedFooter } from '@/ui/PagedFooter';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

/**
 * Inventario en Android/iOS (en la Web: inventory.web.tsx). Solo lo que lleva existencias (productos y lo aún sin
 * clasificar). Conteos por estado de \`/items/summary\`; la cuadrícula es virtual y paginada por cursor, con los filtros
 * de categoría y estado en el servidor. Desde una alerta del Inicio se abre ya filtrado (/inventory?status=reorder).
 */
export default function Inventory() {
  const router = useRouter();
  const { colors, t } = useSettings();
  const { business } = useAuthed();
  const categories = useCategories();
  const [category, setCategory] = useState<string | null>(null);
  const params = useLocalSearchParams<{ status?: string }>();
  const fromLink = (STOCK_STATUSES as readonly string[]).includes(params.status ?? '') ? (params.status as StockStatus) : null;
  const [status, setStatus] = useState<StockStatus | null>(fromLink);
  useEffect(() => {
    if (fromLink) setStatus(fromLink);
  }, [fromLink]);

  const items = useItemsPages({ tracked: true, categoryId: category ?? undefined, stockStatus: status ?? undefined });
  const summary = useItemsSummary();
  const visible = useMemo(() => flatPages(items.data), [items.data]);

  const stock = summary.data?.stock;
  const counts: Record<StockStatus, number | undefined> = { available: stock?.available, reorder: stock?.reorder, out_of_stock: stock?.outOfStock };
  const cards: Array<{ label: string; value: string; color: string }> = [
    { label: 'Total', value: stock ? String(stock.total) : '—', color: colors.gold },
    ...STOCK_STATUSES.map((s) => ({ label: t(`status_${s}`), value: counts[s] !== undefined ? String(counts[s]) : '—', color: stockColor(s, colors) })),
  ];

  const header = (
    <View>
      <View style={styles.summary}>
        {cards.map((card) => (
          <Card key={card.label} style={[styles.summaryCard, { borderColor: `${card.color}59` }]}>
            <AppText variant="title" style={{ color: card.color }}>
              {card.value}
            </AppText>
            <AppText variant="small" tone="muted" numberOfLines={1}>
              {card.label}
            </AppText>
          </Card>
        ))}
      </View>

      <AppText variant="label" tone="gold" style={styles.filterLabel}>
        {t('filter_category')}
      </AppText>
      <ChipRow label={t('filter_category')}>
        <Chip label={t('all')} selected={category === null} onPress={() => setCategory(null)} />
        {categories.data?.map((c) => (
          <Chip key={c.id} label={c.name} selected={category === c.id} onPress={() => setCategory(c.id)} />
        ))}
      </ChipRow>

      <AppText variant="label" tone="gold" style={styles.filterLabel}>
        {t('filter_status')}
      </AppText>
      <ChipRow label={t('filter_status')}>
        <Chip label={t('all_m')} selected={status === null} onPress={() => setStatus(null)} />
        {STOCK_STATUSES.map((s) => (
          <Chip key={s} label={t(`status_${s}`)} selected={status === s} onPress={() => setStatus(s)} />
        ))}
      </ChipRow>

      <Button label={t('add_to_inventory')} icon="add" onPress={() => router.push('/item/form')} style={styles.add} />
      <AppText variant="small" tone="muted" style={styles.note}>
        {t('inventory_sync_note')}
      </AppText>
    </View>
  );

  return (
    <Screen
      scroll={false}
      header={
        <Header
          root
          title={t('inventory')}
          subtitle={t('inventory_sub')}
          right={
            <Pressable accessibilityRole="button" onPress={() => router.push('/categories')} hitSlop={8}>
              <AppText variant="label" tone="gold">
                {t('categories')}
              </AppText>
            </Pressable>
          }
        />
      }>
      <ItemFlatGrid
        data={visible}
        renderItem={(item) => <InventoryCard item={item} currency={business.currency} onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })} />}
        header={header}
        empty={
          items.isPending ? (
            <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
          ) : items.isError ? (
            <View style={{ alignItems: 'center', gap: 12, marginTop: 24 }}>
              <AppText tone="danger" center>
                {t(errorKey(items.error))}
              </AppText>
              <Button label={t('retry')} variant="secondary" compact onPress={() => void items.refetch()} />
            </View>
          ) : (
            <EmptyState icon="cube-outline" message={t('no_items')} />
          )
        }
        footer={visible.length > 0 ? <PagedFooter loading={items.isFetchingNextPage} error={items.isFetchNextPageError ? items.error : null} onRetry={() => void items.fetchNextPage()} /> : null}
        onEndReached={() => {
          if (items.hasNextPage && !items.isFetchingNextPage && !items.isFetchNextPageError) void items.fetchNextPage();
        }}
        refreshControl={<RefreshControl refreshing={items.isRefetching && !items.isFetchingNextPage} onRefresh={() => void Promise.all([items.refetch(), summary.refetch()])} tintColor={colors.gold} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', gap: 8 },
  summaryCard: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  filterLabel: { marginTop: 16, marginBottom: 4 },
  add: { marginTop: 16 },
  note: { marginTop: 8, marginBottom: 14 },
});
