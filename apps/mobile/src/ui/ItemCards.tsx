import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type Currency, type Item } from '@xiro/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSettings } from '@/lib/settings';
import { Photo, StatusPill, stockColor } from './Kit';
import { AppText } from './Text';
import { MAX_CONTENT_WIDTH, radius } from './theme';

/** Cuadrícula responsiva: 2 columnas en teléfono, 3 en pantallas anchas. */
export function ItemGrid({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const columns = Math.min(width, MAX_CONTENT_WIDTH) >= 560 ? 3 : 2;
  const cell = `${100 / columns - 2}%` as const;
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
        <AppText variant="small" tone="gold" numberOfLines={1}>
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
          <Ionicons name="chevron-forward" size={16} color={colors.gold} />
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
  card: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 2 },
  photo: { borderRadius: 0, aspectRatio: 1.25 },
  body: { padding: 11, gap: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  hidden: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4 },
});
