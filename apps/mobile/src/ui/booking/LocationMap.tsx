import type { GeoPoint } from '@xiro/shared';
import { StaticMapImage } from './StaticMapImage';

/**
 * Variante nativa (Android/iOS): mapa estático con el pin dorado. El mapa nativo con pin arrastrable llegará aparte
 * (requiere react-native-maps y un build de desarrollo nuevo); mientras, el punto se ajusta buscando, pegando o con "mi ubicación".
 * La web es LocationMap.web.tsx (Google Maps con pin arrastrable). Misma API: test/variants.parity.test.ts lo vigila.
 */
export function LocationMap({ point }: { point: GeoPoint; onMove: (point: GeoPoint) => void }) {
  return <StaticMapImage point={point} />;
}
