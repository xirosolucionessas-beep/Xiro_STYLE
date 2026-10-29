import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type Currency, type Item } from '@xiro/shared';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSettings } from '@/lib/settings';
import { Photo, StatusPill, stockColor } from './Kit';
import { AppText } from './Text';
import { MAX_CONTENT_WIDTH, radius } from './theme';

/** 2 columnas en teléfono, 3 en pantallas anchas. */
function useGridColumns() {
  const { width } = useWindowDimensions();
  const columns = Math.min(width, MAX_CONTENT_WIDTH) >= 560 ? 3 : 2;
  return { columns, cell: `${100 / columns - 2}%` as const };
}

/** Cuadrícula responsiva: 2 columnas en teléfono, 3 en pantallas anchas. */
export function ItemGrid({ children }: { children: ReactNode }) {
  const { cell } = useGridColumns();
  const nodes = Array.isArray(children) ? children : [children];
  return (
    <View style={styles.grid}>
      {nodes.map((child, index) => (
        <View key={index} style={{ width: cell }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * La misma cuadrícula, virtualizada (FlatList con columnas) para listas paginadas: solo se dibuja lo que está en
 * pantalla y la página siguiente se pide al acercarse al final (`onEndReached`). Mismos anchos y espaciado que ItemGrid.
 */
export function ItemFlatGrid<T extends { id: string }>(props: {
  data: readonly T[];
  renderItem: (item: T) => ReactElement;
  header?: ReactElement;
  empty?: ReactElement;
  footer?: ReactElement | null;
  onEndReached?: () => void;
  refreshControl?: ComponentProps<typeof FlatList>['refreshControl'];
}) {
  const { columns, cell } = useGridColumns();
  return (
    <FlatList
      // Cambiar de 2 a 3 columnas exige volver a montar la lista (restricción de FlatList).
      key={columns}
      data={props.data}
      numColumns={columns}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <View style={{ width: cell }}>{props.renderItem(item)}</View>}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={props.header}
      ListEmptyComponent={props.empty}
      ListFooterComponent={props.footer}
      onEndReached={props.onEndReached}
      onEndReachedThreshold={0.6}
      initialNumToRender={8}
      maxToRenderPerBatch={10}
      windowSize={9}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.gridContent}
      refreshControl={props.refreshControl}
    />
  );
}

interface CardProps {
  item: Item;
  currency: Currency;
  onPress: () => void;
}

export function InventoryCard({ item, currency, onPress }: CardProps) {
  const { colors, t } = useSettings();
  const color = stockColor(item.stockStatus, colors);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}>
      <Photo url={item.photos[0]?.url} style={styles.photo} />
      <View style={styles.body}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {item.name}
        </AppText>
        <AppText variant="small" tone="muted" numberOfLines={1}>
          {item.categoryName}
        </AppText>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <AppText variant="small" style={{ color, fontWeight: '800' }}>
            {t(`status_${item.stockStatus}`)}
          </AppText>
        </View>
        <AppText variant="small">
          {t('stock')}: {item.stock}
        </AppText>
        <AppText tone="gold" variant="bodyStrong">
          {item.internalUnitCost ? formatMoney(item.internalUnitCost, currency) : '—'}
        </AppText>
      </View>
    </Pressable>
  );
}

export function CatalogCard({ item, currency, onPress }: CardProps) {
  const { colors, t } = useSettings();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}>
      <Photo url={item.photos[0]?.url} icon="cut-outline" style={styles.photo} />
      <View style={styles.body}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {item.name}
        </AppText>
        <AppText variant="small" tone="muted" numberOfLines={1}>
          {item.shortDescription}
        </AppText>
        <View style={styles.priceRow}>
          <AppText tone="gold" variant="bodyStrong">
            {formatMoney(item.price, currency)}
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </View>
        {!item.published ? (
          <View style={[styles.hidden, { borderColor: colors.border }]}>
            <Ionicons name="eye-off-outline" size={12} color={colors.textMuted} />
            <AppText variant="small" tone="muted">
              {t('hidden_from_catalog')}
            </AppText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export { StatusPill };

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  gridRow: { justifyContent: 'space-between', marginBottom: 12 },
  gridContent: { paddingBottom: 32 },
  card: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 2 },
  photo: { borderRadius: 0, aspectRatio: 1.25 },
  body: { padding: 11, gap: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  hidden: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4 },
});
