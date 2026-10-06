import { roundCoord, type GeoPoint } from '@xiro/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';

/**
 * Mapa oscuro con el pin dorado como imagen (Static Maps, armada por el servidor): el selector nativo lo usa siempre, y la web cuando
 * no hay clave de navegador para el mapa interactivo. No se arrastra: el punto se ajusta buscando, pegando o con la ubicación actual.
 */
export function StaticMapImage({ point }: { point: GeoPoint }) {
  const { t, colors } = useSettings();
  const lat = roundCoord(point.lat);
  const lng = roundCoord(point.lng);
  const map = useQuery({ queryKey: ['places-static-map', lat, lng], queryFn: () => api.placesStaticMap(lat, lng), staleTime: 60 * 60_000, retry: false });

  if (map.isPending || map.isError) {
    return (
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {map.isPending ? <ActivityIndicator color={colors.gold} /> : null}
        <AppText variant="small" tone="muted" style={{ marginTop: map.isPending ? 8 : 0, textAlign: 'center' }} accessibilityLiveRegion="polite">
          {map.isPending ? t('bk_loc_map_loading') : t('bk_loc_map_error')}
        </AppText>
      </View>
    );
  }
  return <Image source={{ uri: map.data.image }} style={styles.image} contentFit="cover" accessibilityLabel={t('bk_map_title')} />;
}

const styles = StyleSheet.create({
  box: { height: 180, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  image: { width: '100%', height: 180, borderRadius: radius.md },
});
