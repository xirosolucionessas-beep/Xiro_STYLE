import type { GeoPoint, PickedLocation, PlaceSuggestion, ReverseGeocodeResult } from '@xiro/shared';
import { AppError } from '../errors';

/**
 * Único punto de contacto con Google Maps Platform (Places API New, Geocoding, Static Maps). Todo pasa por el servidor para
 * que la clave nunca llegue al navegador ni a la app. Detrás de una interfaz, igual que `Notifier`: las pruebas usan un
 * sustituto y sin clave configurada simplemente no hay cliente (los endpoints responden `places_not_configured`).
 */
export interface GoogleMaps {
  autocomplete(input: string, sessionToken: string, language: string): Promise<PlaceSuggestion[]>;
  details(placeId: string, sessionToken: string, language: string): Promise<PickedLocation>;
  reverse(point: GeoPoint, language: string): Promise<ReverseGeocodeResult>;
  /** PNG del mapa oscuro con el pin dorado de la marca, centrado en el punto. */
  staticMap(point: GeoPoint, size: { width: number; height: number }): Promise<Buffer>;
}

/** Un ID de lugar de Google son letras, números, "_" y "-": nada más entra en la URL de la consulta. */
export const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
export const SESSION_TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

const TIMEOUT_MS = 8_000;
/** Colombia entera como sesgo (no como filtro): se priorizan sus resultados pero se puede buscar un lugar en otro país. */
const COLOMBIA = { low: { latitude: -4.3, longitude: -79.1 }, high: { latitude: 13.5, longitude: -66.8 } };
const GOLD = '0xd9b636';
// Mapa oscuro de la marca (fondo casi negro, calles apenas más claras, agua más oscura que la tierra, sin íconos).
const DARK_STYLE = [
  'element:geometry|color:0x1d1d20',
  'element:labels.icon|visibility:off',
  'element:labels.text.fill|color:0x9e9a8c',
  'element:labels.text.stroke|color:0x1d1d20',
  'feature:administrative|element:geometry|color:0x3a3a3f',
  'feature:poi|element:geometry|color:0x25252a',
  'feature:road|element:geometry|color:0x2c2c30',
  'feature:road|element:labels.text.fill|color:0xb0ab9b',
  'feature:water|element:geometry|color:0x0d0d0f',
];

const upstream = () => new AppError(502, 'places_upstream_error');

export class GoogleMapsClient implements GoogleMaps {
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      const res = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw upstream();
      return res;
    } catch (error) {
      // Nunca se propaga el mensaje de Google: podría incluir detalles de la clave o de su restricción.
      throw error instanceof AppError ? error : upstream();
    }
  }

  async autocomplete(input: string, sessionToken: string, language: string): Promise<PlaceSuggestion[]> {
    const res = await this.call('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.key },
      body: JSON.stringify({ input, sessionToken, languageCode: language, regionCode: 'CO', locationBias: { rectangle: COLOMBIA } }),
    });
    const body = (await res.json()) as { suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }> };
    const out: PlaceSuggestion[] = [];
    for (const item of body.suggestions ?? []) {
      const p = item.placePrediction;
      if (!p?.placeId || !PLACE_ID.test(p.placeId)) continue;
      const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? '';
      out.push({ placeId: p.placeId, text: main, secondaryText: p.structuredFormat?.secondaryText?.text ?? '' });
    }
    return out.slice(0, 6);
  }

  async details(placeId: string, sessionToken: string, language: string): Promise<PickedLocation> {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=${language}&sessionToken=${encodeURIComponent(sessionToken)}`;
    const res = await this.call(url, { headers: { 'X-Goog-Api-Key': this.key, 'X-Goog-FieldMask': 'id,formattedAddress,location' } });
    const body = (await res.json()) as { id?: string; formattedAddress?: string; location?: { latitude?: number; longitude?: number } };
    const lat = body.location?.latitude;
    const lng = body.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') throw upstream();
    return { lat, lng, address: body.formattedAddress ?? '', placeId: body.id && PLACE_ID.test(body.id) ? body.id : placeId };
  }

  async reverse(point: GeoPoint, language: string): Promise<ReverseGeocodeResult> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lng}&language=${language}&key=${encodeURIComponent(this.key)}`;
    const body = (await (await this.call(url)).json()) as { status?: string; results?: Array<{ formatted_address?: string; place_id?: string }> };
    // Sin resultados (mar, desierto…) no es un error: el pin sigue valiendo, solo no hay dirección que ponerle.
    if (body.status === 'ZERO_RESULTS') return { address: '', placeId: null };
    if (body.status !== 'OK') throw upstream();
    const first = body.results?.[0];
    return { address: first?.formatted_address ?? '', placeId: first?.place_id && PLACE_ID.test(first.place_id) ? first.place_id : null };
  }

  async staticMap(point: GeoPoint, size: { width: number; height: number }): Promise<Buffer> {
    const center = `${point.lat},${point.lng}`;
    const params = new URLSearchParams({ center, zoom: '16', size: `${size.width}x${size.height}`, scale: '2', maptype: 'roadmap', format: 'png', markers: `color:${GOLD}|${center}`, key: this.key });
    for (const style of DARK_STYLE) params.append('style', style);
    const res = await this.call(`https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`);
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw upstream();
    return Buffer.from(await res.arrayBuffer());
  }
}
