/**
 * Ubicación del local: interpretar lo que la persona pega (coordenadas decimales, grados/minutos/segundos o un enlace de
 * Google Maps) y armar los enlaces para "cómo llegar". Todo puro y sin dependencias: lo usan la app y la página pública.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Lo que el selector de ubicación guarda: el pin exacto, la dirección que lo describe y el lugar de Google (si vino de uno). */
export interface PickedLocation extends GeoPoint {
  address: string;
  placeId: string | null;
}

/** Una sugerencia del autocompletado (Places API New), ya reducida a lo que la pantalla necesita. */
export interface PlaceSuggestion {
  placeId: string;
  text: string;
  secondaryText: string;
}

export interface ReverseGeocodeResult {
  address: string;
  placeId: string | null;
}

/** Estado del mapa en el servidor: `enabled` = hay clave de Google; `browserKey` solo se entrega a quien gestiona la página. */
export interface PlacesConfig {
  enabled: boolean;
  browserKey: string | null;
}

export type LocationSource = 'decimal' | 'dms' | 'url';
export type LocationParseError = 'empty' | 'short_link' | 'invalid' | 'out_of_range';
export type LocationParseResult = { point: GeoPoint; source: LocationSource } | { error: LocationParseError };

const inRange = (p: GeoPoint) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const num = (s: string) => Number(s.replace(',', '.'));
const isNumber = (s: string) => /^-?\d+(?:[.,]\d+)?$/.test(s);

/** Redondea a 6 decimales (≈ 11 cm): más precisión no significa nada y ensucia los enlaces. */
export const roundCoord = (value: number): number => Math.round(value * 1e6) / 1e6;

export function formatCoords(point: GeoPoint): string {
  return `${roundCoord(point.lat).toFixed(6)}, ${roundCoord(point.lng).toFixed(6)}`;
}

/* ---------- Enlaces de Google Maps ---------- */

const SHORT_LINK = /^(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\b/i;
const LOOKS_LIKE_URL = /^(?:https?:\/\/|www\.)|google\.[a-z.]+\/maps|maps\.google\./i;

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function fromMapsUrl(raw: string): GeoPoint | null {
  const text = safeDecode(raw);
  // 1) El pin del lugar (!3d<lat>!4d<lng>) es más exacto que el centro de la vista (@lat,lng), por eso va primero.
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(text);
  if (pin) return { lat: Number(pin[1]), lng: Number(pin[2]) };
  // 2) Centro de la vista: .../@4.0833,-76.2,17z
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(text);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  // 3) Parámetros: ?q=lat,lng · ?query=lat,lng · ?ll=lat,lng · ?destination=lat,lng · ?center=lat,lng
  const param = /[?&#](?:q|query|ll|destination|center|daddr)=\s*\(?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)?/.exec(text);
  if (param) return { lat: Number(param[1]), lng: Number(param[2]) };
  return null;
}

/* ---------- Grados, minutos y segundos ---------- */

// 4°05'00"N · 4° 05′ N · 4.0833° N · N 4°05' · 76º12'W · 76°12'O (O = oeste, en español)
const DMS_NUMBER = `(?<DEG>\\d{1,3}(?:[.,]\\d+)?)\\s*[°º]?\\s*(?:(?<MIN>\\d{1,2}(?:[.,]\\d+)?)\\s*['′’´]\\s*)?(?:(?<SEC>\\d{1,2}(?:[.,]\\d+)?)\\s*(?:"|″|”|''|′′|’’)\\s*)?`;
// Dos formas que no se mezclan: hemisferio ANTES del número (N 4°05') o DESPUÉS (4°05'N). Si ambos fueran opcionales a la
// vez, el hemisferio del valor siguiente se lo tragaría el anterior ("N 4°05' W 76°12'").
const DMS_PART = new RegExp(`\\b(?<H1>[NSEWO])\\s*${DMS_NUMBER.replace(/\?<(DEG|MIN|SEC)>/g, '?<$1a>')}|${DMS_NUMBER}(?<H2>[NSEWO])\\b`, 'gi');

function fromDms(text: string): GeoPoint | { error: 'invalid' | 'out_of_range' } | null {
  const found: Array<{ axis: 'lat' | 'lng'; value: number }> = [];
  for (const match of text.matchAll(DMS_PART)) {
    const g = match.groups ?? {};
    const hemisphere = (g.H1 ?? g.H2 ?? '').toUpperCase();
    const deg = g.H1 ? g.DEGa : g.DEG;
    if (!hemisphere || !deg) continue;
    const min = g.H1 ? g.MINa : g.MIN;
    const sec = g.H1 ? g.SECa : g.SEC;
    const degrees = num(deg);
    const minutes = min ? num(min) : 0;
    const seconds = sec ? num(sec) : 0;
    if (minutes >= 60 || seconds >= 60) return { error: 'invalid' };
    const magnitude = degrees + minutes / 60 + seconds / 3600;
    const negative = hemisphere === 'S' || hemisphere === 'W' || hemisphere === 'O';
    found.push({ axis: hemisphere === 'N' || hemisphere === 'S' ? 'lat' : 'lng', value: negative ? -magnitude : magnitude });
  }
  // Un solo valor ("4° 05′ N") o dos del mismo eje no son una ubicación: se deja al buscador tratarlo como texto.
  const lat = found.filter((f) => f.axis === 'lat');
  const lng = found.filter((f) => f.axis === 'lng');
  if (found.length !== 2 || lat.length !== 1 || lng.length !== 1) return null;
  const point = { lat: lat[0]!.value, lng: lng[0]!.value };
  return inRange(point) ? point : { error: 'out_of_range' };
}

/* ---------- Decimales ---------- */

function fromDecimal(raw: string): GeoPoint | { error: 'out_of_range' } | null {
  const text = raw.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  let parts: string[] | null = null;
  if (text.includes(';')) parts = text.split(';').map((p) => p.trim());
  else if (/,\s/.test(text) && text.split(/,\s+/).length === 2) parts = text.split(/,\s+/);
  else if (text.split(',').length === 2) parts = text.split(',');
  else if (text.split(' ').length === 2) parts = text.split(' ');
  if (!parts || parts.length !== 2) return null;
  const [a, b] = parts.map((p) => p.trim()) as [string, string];
  if (!isNumber(a) || !isNumber(b)) return null;
  const point = { lat: num(a), lng: num(b) };
  return inRange(point) ? point : { error: 'out_of_range' };
}

/**
 * Interpreta lo que la persona pega en el buscador de ubicación. `{ error: 'invalid' }` significa "no parece una
 * coordenada": el buscador lo trata entonces como texto de una dirección y no como un error.
 */
export function parseLocationInput(input: string): LocationParseResult {
  const text = input.trim();
  if (text === '') return { error: 'empty' };

  if (LOOKS_LIKE_URL.test(text)) {
    // Un enlace corto solo dice a dónde va si se abre; desde aquí no se puede saber sin salir a internet.
    if (SHORT_LINK.test(text)) return { error: 'short_link' };
    const point = fromMapsUrl(text);
    if (!point) return { error: 'invalid' };
    return inRange(point) ? { point, source: 'url' } : { error: 'out_of_range' };
  }

  const dms = fromDms(text);
  if (dms) return 'error' in dms ? dms : { point: dms, source: 'dms' };

  const decimal = fromDecimal(text);
  if (decimal) return 'error' in decimal ? decimal : { point: decimal, source: 'decimal' };

  return { error: 'invalid' };
}

/* ---------- "Cómo llegar" ---------- */

export interface Destination extends GeoPoint {
  placeId?: string | null;
}

export function googleMapsDirectionsUrl(place: Destination): string {
  const base = `https://www.google.com/maps/dir/?api=1&destination=${roundCoord(place.lat)},${roundCoord(place.lng)}`;
  return place.placeId ? `${base}&destination_place_id=${encodeURIComponent(place.placeId)}` : base;
}

export function wazeUrl(place: GeoPoint): string {
  return `https://waze.com/ul?ll=${roundCoord(place.lat)},${roundCoord(place.lng)}&navigate=yes`;
}

/** Para negocios con dirección escrita pero sin pin: Google Maps y Waze buscan el texto en vez de ir a unas coordenadas. */
export const googleMapsSearchUrl = (query: string): string => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;
export const wazeSearchUrl = (query: string): string => `https://waze.com/ul?q=${encodeURIComponent(query.trim())}&navigate=yes`;
