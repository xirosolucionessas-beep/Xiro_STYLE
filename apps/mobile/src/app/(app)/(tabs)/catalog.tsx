import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { errorKey } from '@/lib/api';
import { useCategories, useItems } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { CatalogCard, ItemGrid } from '@/ui/ItemCards';
import { Chip, ChipRow, EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function Catalog() {
  const router = useRouter();
  const { colors, t } = useSettings();
  const { business } = useAuthed();
  const items = useItems();
  const categories = useCategories();
  const [category, setCategory] = useState<string | null>(null);

  const visible = useMemo(() => (items.data ?? []).filter((item) => !category || item.categoryId === category), [items.data, category]);

  return (
    <Screen
      refreshing={items.isRefetching}
      onRefresh={() => void items.refetch()}
      header={
        <Header
          root
          title={t('catalog')}
          subtitle={t('catalog_sub')}
          right={
            <Pressable accessibilityRole="button" onPress={() => router.push('/categories')} hitSlop={8}>
              <AppText variant="label" tone="gold">
                {t('categories')}
              </AppText>
            </Pressable>
          }
        />
      }
      footer={<Button label={t('send_catalog')} icon="send" onPress={() => router.push({ pathname: '/share', params: { mode: 'catalog' } })} />}>
      <ChipRow label={t('filter_category')}>
        <Chip label={t('all')} selected={category === null} onPress={() => setCategory(null)} />
        {categories.data?.map((c) => (
          <Chip key={c.id} label={c.name} selected={category === c.id} onPress={() => setCategory(c.id)} />
        ))}
      </ChipRow>

      <Button label={t('add_to_catalog')} variant="secondary" icon="add" onPress={() => router.push('/item/form')} style={styles.add} />

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
        <EmptyState icon="book-outline" message={t('no_items')} />
      ) : (
        <ItemGrid>
          {visible.map((item) => (
            <CatalogCard key={item.id} item={item} currency={business.currency} onPress={() => router.push({ pathname: '/catalog-item/[id]', params: { id: item.id } })} />
          ))}
        </ItemGrid>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: { marginVertical: 14 },
});
