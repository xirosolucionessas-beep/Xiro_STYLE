import { parseLocationInput, roundCoord, type GeoPoint, type Language, type PickedLocation, type PlaceSuggestion } from '@xiro/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorKey } from './api';
import { getCurrentPosition } from './currentPosition';
import { PositionError } from './positionError';
import { usePlacesConfig } from './queries';

export const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 3;
/** Un salto de este tamaño en el texto de una sola vez es un pegado, no alguien tecleando. */
const PASTE_JUMP = 6;

/** Token de sesión de Places: agrupa lo tecleado y la elección final en UNA sola facturación en Google. */
const newSessionToken = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

type Busy = 'details' | 'locating' | 'updating' | null;

export interface LocationPickerOptions {
  value: PickedLocation | null;
  onChange: (next: PickedLocation | null) => void;
  language: Language;
  debounceMs?: number;
}

/**
 * Lógica del selector de ubicación (la pantalla solo la dibuja): buscador con autocompletado (debounce, sesión de Places, sin
 * resultados de una búsqueda anterior), pegar coordenadas / grados / enlace de Google Maps, "usar mi ubicación actual", elegir
 * una sugerencia y mover el pin. Una elección o un movimiento del pin SIEMPRE conservan las coordenadas exactas; la dirección
 * se pide aparte y si falla el punto queda igual (solo sin dirección).
 */
export function useLocationPicker({ value, onChange, language, debounceMs = SEARCH_DEBOUNCE_MS }: LocationPickerOptions) {
  const config = usePlacesConfig();
  // Mientras no se sepa si hay Google configurado no se bloquea nada: pegar coordenadas funciona igual sin él.
  const searchEnabled = config.data?.enabled === true;

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; items: PlaceSuggestion[]; failed: boolean } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);

  const session = useRef(newSessionToken());
  const reverseSeq = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const text = query.trim();
  const parsed = useMemo(() => parseLocationInput(text), [text]);
  const coordsOffer: GeoPoint | null = 'point' in parsed ? parsed.point : null;
  const inputError = 'error' in parsed ? (parsed.error === 'short_link' ? 'bk_loc_err_short_link' : parsed.error === 'out_of_range' ? 'bk_loc_err_range' : null) : null;
  // Lo que se escribe y no es una coordenada ni un enlace es el texto de una dirección o de un lugar.
  const searchable = searchEnabled && text.length >= MIN_QUERY && 'error' in parsed && parsed.error === 'invalid';

  // Buscar al dejar de teclear. El resultado lleva el texto con el que se pidió: si ya cambió, no se muestra (nada viejo a la vista).
  useEffect(() => {
    if (!searchable) return;
    let stale = false;
    const timer = setTimeout(() => {
      api
        .placesAutocomplete(text, session.current, language)
        .then((items) => !stale && setResult({ query: text, items, failed: false }))
        .catch(() => !stale && setResult({ query: text, items: [], failed: true }));
    }, debounceMs);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [searchable, text, language, debounceMs]);

  const fresh = result !== null && result.query === text;
  const suggestions = searchable && fresh ? result.items : [];
  const searching = searchable && !fresh;
  const searchFailed = searchable && fresh && result.failed;
  const noResults = searchable && fresh && !result.failed && result.items.length === 0;

  async function applyPoint(point: GeoPoint): Promise<void> {
    const exact = { lat: roundCoord(point.lat), lng: roundCoord(point.lng) };
    const mine = ++reverseSeq.current;
    setQuery('');
    setMessage(null);
    setBusy('updating');
    // El pin se mueve YA; la dirección llega después (y si otro movimiento la adelanta, se descarta la vieja).
    onChangeRef.current({ ...exact, address: '', placeId: null });
    try {
      const found = await api.placesReverse(exact.lat, exact.lng, language);
      if (mine !== reverseSeq.current) return;
      onChangeRef.current({ ...exact, address: found.address, placeId: found.placeId });
      if (!found.address) setMessage('bk_loc_no_address');
    } catch (error) {
      if (mine !== reverseSeq.current) return;
      setMessage(searchEnabled || config.isPending ? errorKey(error) : 'bk_loc_not_configured');
    } finally {
      if (mine === reverseSeq.current) setBusy(null);
    }
  }

  return {
    query,
    /** Escribir. Un pegado de coordenadas o de un enlace de Google Maps se aplica solo; lo demás se busca. */
    changeQuery(next: string) {
      const jumped = next.length - query.length > PASTE_JUMP;
      setQuery(next);
      setMessage(null);
      if (!jumped) return;
      const pasted = parseLocationInput(next);
      if ('point' in pasted) void applyPoint(pasted.point);
    },
    suggestions,
    coordsOffer,
    searchEnabled,
    configLoaded: !config.isPending,
    /** Texto de estado ya como clave de i18n (`{coords}` en `bk_loc_use_coords` lo pone la pantalla). */
    status: busy === 'locating' ? 'bk_loc_locating' : busy === 'updating' ? 'bk_loc_updating_address' : busy === 'details' ? 'bk_loc_searching' : searching ? 'bk_loc_searching' : null,
    busy: busy !== null,
    error: message ?? inputError ?? (searchFailed ? 'bk_loc_err_search' : noResults ? 'bk_loc_no_results' : null),
    async pick(suggestion: PlaceSuggestion) {
      setBusy('details');
      setMessage(null);
      try {
        const place = await api.placesDetails(suggestion.placeId, session.current, language);
        reverseSeq.current += 1; // una geocodificación en vuelo ya no manda sobre esta elección
        onChangeRef.current({ lat: roundCoord(place.lat), lng: roundCoord(place.lng), address: place.address, placeId: place.placeId });
        setQuery('');
        session.current = newSessionToken(); // la sesión de facturación termina con la elección
      } catch (error) {
        setMessage(errorKey(error));
      } finally {
        setBusy(null);
      }
    },
    applyCoords: applyPoint,
    /** Soltar el pin: coordenadas exactas de donde cayó; solo la dirección se actualiza. */
    movePin: applyPoint,
    async locate() {
      setBusy('locating');
      setMessage(null);
      try {
        await applyPoint(await getCurrentPosition());
      } catch (error) {
        setBusy(null);
        setMessage(error instanceof PositionError ? `bk_loc_err_${error.code}` : 'bk_loc_err_unavailable');
      }
    },
    clear() {
      reverseSeq.current += 1;
      setQuery('');
      setMessage(null);
      setBusy(null);
      onChangeRef.current(null);
    },
    value,
  };
}
