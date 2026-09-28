import type { GeoPoint } from '@xiro/shared';
import { PositionError } from './positionError';

const TIMEOUT_MS = 12_000;

/**
 * Variante WEB de currentPosition.ts: `navigator.geolocation` (exige HTTPS o localhost; el navegador muestra su propio aviso
 * de permiso). Mismo contrato que la nativa: devuelve el punto o lanza `PositionError` con el motivo.
 */
export function getCurrentPosition(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new PositionError('unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      // 1 = permiso denegado, 3 = se agotó el tiempo, 2 (y cualquier otro) = no hay forma de saber dónde está.
      (error) => reject(new PositionError(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 30_000 },
    );
  });
}
