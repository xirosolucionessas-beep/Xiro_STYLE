/**
 * Carga la API de JavaScript de Google Maps UNA vez (solo web; el archivo lo importa únicamente LocationMap.web.tsx). Sin
 * dependencias: se inyecta el <script> con la clave del NAVEGADOR (restringida por dominio en Google Cloud) y se espera al callback.
 * Tipos mínimos propios en vez de @types/google.maps: solo se usa una fracción muy pequeña de la API.
 */
export interface GLatLng {
  lat(): number;
  lng(): number;
}
export interface GMapInstance {
  panTo(position: { lat: number; lng: number }): void;
  addListener(event: 'click', handler: (event: { latLng?: GLatLng | null }) => void): void;
}
export interface GMarkerInstance {
  setPosition(position: { lat: number; lng: number }): void;
  getPosition(): GLatLng | null | undefined;
  addListener(event: 'dragend', handler: () => void): void;
}
export interface GoogleMapsApi {
  maps: {
    Map: new (element: HTMLElement, options: object) => GMapInstance;
    Marker: new (options: object) => GMarkerInstance;
    Point: new (x: number, y: number) => unknown;
  };
}

const TIMEOUT_MS = 15_000;
const CALLBACK = '__xiroGoogleMapsReady';
let loading: Promise<GoogleMapsApi> | null = null;

type MapsWindow = Window & { google?: Partial<GoogleMapsApi>; gm_authFailure?: () => void; [CALLBACK]?: () => void };

export function loadGoogleMaps(key: string, language: string): Promise<GoogleMapsApi> {
  const w = window as MapsWindow;
  if (w.google?.maps?.Map) return Promise.resolve(w.google as GoogleMapsApi);
  loading ??= new Promise<GoogleMapsApi>((resolve, reject) => {
    const fail = (reason: string) => {
      loading = null; // un fallo no se recuerda: reabrir el selector lo vuelve a intentar
      reject(new Error(reason));
    };
    const timer = setTimeout(() => fail('maps_timeout'), TIMEOUT_MS);
    w[CALLBACK] = () => {
      clearTimeout(timer);
      resolve(w.google as GoogleMapsApi);
    };
    // Google llama a esta función global cuando la clave no sirve para este dominio (restricción mal puesta, API sin activar, sin facturación).
    w.gm_authFailure = () => {
      clearTimeout(timer);
      fail('maps_auth_failure');
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=${encodeURIComponent(language)}&callback=${CALLBACK}`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      fail('maps_script_failed');
    };
    document.head.appendChild(script);
  });
  return loading;
}
