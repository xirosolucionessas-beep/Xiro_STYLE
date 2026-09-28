import { STOCK_STATUSES, summarizeStock, type StockStatus } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { errorKey } from '@/lib/api';
import { tracksStock } from '@/lib/homeMetrics';
import { useCategories, useItems } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { InventoryCard, ItemGrid } from '@/ui/ItemCards';
import { Card, Chip, ChipRow, EmptyState, stockColor } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function Inventory() {
  const router = useRouter();
  const { colors, t } = useSettings();
  const { business } = useAuthed();
  const items = useItems();
  const categories = useCategories();
  const [category, setCategory] = useState<string | null>(null);
  // Desde una alerta del Inicio se abre ya filtrado (/inventory?status=reorder).
  const params = useLocalSearchParams<{ status?: string }>();
  const fromLink = (STOCK_STATUSES as readonly string[]).includes(params.status ?? '') ? (params.status as StockStatus) : null;
  const [status, setStatus] = useState<StockStatus | null>(fromLink);
  useEffect(() => {
    if (fromLink) setStatus(fromLink);
  }, [fromLink]);

  // Inventario = productos (los servicios no llevan existencias).
  const all = useMemo(() => (items.data ?? []).filter(tracksStock), [items.data]);
  const summary = useMemo(() => summarizeStock(all), [all]);
  const visible = useMemo(
    () => all.filter((item) => (!category || item.categoryId === category) && (!status || item.stockStatus === status)),
    [all, category, status],
  );

  const cards: Array<{ label: string; value: number; color: string }> = [
    { label: 'Total', value: summary.total, color: colors.gold },
    ...STOCK_STATUSES.map((s) => ({ label: t(`status_${s}`), value: summary[s], color: stockColor(s, colors) })),
  ];

  return (
    <Screen
      refreshing={items.isRefetching}
      onRefresh={() => void items.refetch()}
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

      {items.isPending ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
      ) : items.isError ? (
        <View style={{ alignItems: 'center', gap: 12, marginTop: 24 }}>
          <AppText tone="danger" center>
            {t(errorKey(items.error))}
          </AppText>
          <Button label={t('retry')} variant="secondary" compact onPress={() => void items.refetch()} />
        </View>
      ) : visible.length === 0 ? (
        <EmptyState icon="cube-outline" message={t('no_items')} />
      ) : (
        <ItemGrid>
          {visible.map((item) => (
            <InventoryCard key={item.id} item={item} currency={business.currency} onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })} />
          ))}
        </ItemGrid>
      )}
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
