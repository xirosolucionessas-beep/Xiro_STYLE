/**
 * Variante WEB de LocationMap.tsx: mapa de Google (API de JavaScript) en modo oscuro con el pin dorado ARRASTRABLE. Al soltarlo
 * (o al tocar otro punto del mapa) avisa las coordenadas exactas; la dirección la actualiza quien lo usa. Sin clave de navegador
 * configurada en el servidor cae al mapa estático, sin arrastre. Si Google rechaza la clave o no carga, lo dice y el punto se conserva.
 */
import { type GeoPoint } from '@xiro/shared';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { loadGoogleMaps, type GMapInstance, type GMarkerInstance } from '@/lib/googleMapsLoader';
import { usePlacesConfig } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { StaticMapImage } from './StaticMapImage';

const GOLD = '#d9b636';
const HEIGHT = 260;
// Mismos tonos que el mapa estático del servidor (booking/google.ts): fondo casi negro, calles apenas más claras, sin íconos.
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d1d20' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9e9a8c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d1d20' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#3a3a3f' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#25252a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2c30' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#b0ab9b' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d0d0f' }] },
];
const PIN_PATH = 'M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z';

export function LocationMap({ point, onMove }: { point: GeoPoint; onMove: (point: GeoPoint) => void }) {
  const config = usePlacesConfig();
  const key = config.data?.browserKey ?? null;
  if (config.isPending) return <MapNotice loading />;
  return key ? <InteractiveMap apiKey={key} point={point} onMove={onMove} /> : <StaticMapImage point={point} />;
}

function MapNotice({ loading, error }: { loading?: boolean; error?: boolean }) {
  const { t, colors } = useSettings();
  return (
    <View style={{ height: HEIGHT, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {loading ? <ActivityIndicator color={colors.gold} /> : null}
      <AppText variant="small" tone="muted" style={{ textAlign: 'center', marginTop: loading ? 8 : 0 }} accessibilityLiveRegion="polite">
        {error ? t('bk_loc_map_error') : t('bk_loc_map_loading')}
      </AppText>
    </View>
  );
}

function InteractiveMap({ apiKey, point, onMove }: { apiKey: string; point: GeoPoint; onMove: (point: GeoPoint) => void }) {
  const { t, language } = useSettings();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<GMapInstance | null>(null);
  const marker = useRef<GMarkerInstance | null>(null);
  const pointRef = useRef(point);
  const onMoveRef = useRef(onMove);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    onMoveRef.current = onMove;
    pointRef.current = point;
  });

  // Dibuja el mapa una sola vez; después el pin se mueve (ver el efecto de abajo) sin recrear nada.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey, language)
      .then((google) => {
        if (cancelled || !host.current) return;
        const start = { lat: pointRef.current.lat, lng: pointRef.current.lng };
        const instance = new google.maps.Map(host.current, { center: start, zoom: 16, styles: DARK_STYLE, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false });
        const pin = new google.maps.Marker({
          map: instance,
          position: start,
          draggable: true,
          icon: { path: PIN_PATH, fillColor: GOLD, fillOpacity: 1, strokeColor: '#0d0d0f', strokeWeight: 1.5, scale: 1.7, anchor: new google.maps.Point(12, 22) },
        });
        pin.addListener('dragend', () => {
          const at = pin.getPosition();
          if (at) onMoveRef.current({ lat: at.lat(), lng: at.lng() });
        });
        instance.addListener('click', (event) => {
          if (event.latLng) onMoveRef.current({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        });
        map.current = instance;
        marker.current = pin;
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [apiKey, language]);

  // Buscar, elegir una sugerencia o usar "mi ubicación" mueve el pin y centra el mapa.
  useEffect(() => {
    const position = { lat: point.lat, lng: point.lng };
    marker.current?.setPosition(position);
    map.current?.panTo(position);
  }, [point.lat, point.lng]);

  if (status === 'error') return <MapNotice error />;
  return (
    <View>
      {/* El contenedor SIEMPRE tiene su tamaño (Google dibuja según el que tenga al crearse); el aviso de carga va encima. */}
      <View style={{ height: HEIGHT }}>
        <div ref={host} role="application" aria-label={t('bk_map_title')} style={{ height: HEIGHT, borderRadius: 14, overflow: 'hidden', background: '#1d1d20' }} />
        {status === 'loading' ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <MapNotice loading />
          </View>
        ) : null}
      </View>
      {status === 'ready' ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 6 }}>
          {t('bk_loc_drag_hint')}
        </AppText>
      ) : null}
    </View>
  );
}
