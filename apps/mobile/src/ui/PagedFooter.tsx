import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { errorKey } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { AppText } from './Text';

/**
 * Pie de una lista paginada (FlatList + useInfiniteQuery): ruedita mientras llega la página siguiente y, si falla,
 * el motivo (sin conexión, tiempo agotado…) con "Reintentar" — sin perder lo que ya estaba cargado.
 */
export function PagedFooter({ loading, error, onRetry }: { loading: boolean; error: unknown; onRetry: () => void }) {
  const { colors, t } = useSettings();
  if (loading) return <ActivityIndicator color={colors.gold} style={styles.spinner} accessibilityLabel={t('dash_loading')} />;
  if (!error) return <View style={styles.spacer} />;
  return (
    <View style={styles.error} accessibilityLiveRegion="polite">
      <AppText tone="danger" center variant="small">
        {t(errorKey(error))}
      </AppText>
      <Button label={t('retry')} variant="secondary" compact onPress={onRetry} />
    </View>
  );
}

/** Lo que necesita LoadMoreButton de un useInfiniteQuery. */
export interface InfiniteLike {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  error: unknown;
  fetchNextPage: () => unknown;
}

/**
 * "Cargar más" para listas paginadas dentro de una pantalla con scroll (donde no cabe una FlatList): solo aparece si
 * hay más páginas; muestra la ruedita mientras llega y, si falla, el motivo con "Reintentar".
 */
export function LoadMoreButton({ query }: { query: InfiniteLike }) {
  const { t } = useSettings();
  if (query.isFetchingNextPage || query.isFetchNextPageError) return <PagedFooter loading={query.isFetchingNextPage} error={query.isFetchNextPageError ? query.error : null} onRetry={() => void query.fetchNextPage()} />;
  if (!query.hasNextPage) return null;
  return <Button label={t('load_more')} variant="ghost" compact onPress={() => void query.fetchNextPage()} style={styles.more} />;
}

const styles = StyleSheet.create({
  spinner: { marginVertical: 20 },
  spacer: { height: 24 },
  error: { alignItems: 'center', gap: 10, marginVertical: 16 },
  more: { alignSelf: 'center', marginVertical: 8 },
});
