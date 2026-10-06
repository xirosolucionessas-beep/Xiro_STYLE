import type { GeoPoint } from '@xiro/shared';
import * as Location from 'expo-location';
import { PositionError } from './positionError';

const TIMEOUT_MS = 12_000;

/**
 * Variante nativa (Android/iOS): pide el permiso "mientras se usa la app" y lee la posición con `expo-location`.
 * La web usa `navigator.geolocation` (currentPosition.web.ts) con el mismo contrato: devuelve el punto o lanza `PositionError`.
 */
export async function getCurrentPosition(): Promise<GeoPoint> {
  if (!(await Location.hasServicesEnabledAsync().catch(() => false))) throw new PositionError('unavailable');
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new PositionError('denied');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PositionError('timeout')), TIMEOUT_MS);
    });
    const position = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout]);
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch (error) {
    throw error instanceof PositionError ? error : new PositionError('unavailable');
  } finally {
    clearTimeout(timer);
  }
}
