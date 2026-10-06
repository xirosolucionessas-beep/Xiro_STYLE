# Ubicación del local con Google Maps — configuración

"Mi página web → Ubicación en el mapa" usa Google Maps Platform. **Sin claves todo sigue funcionando**: se puede pegar
coordenadas o un enlace largo de Google Maps (el parser corre en la app), y la página pública muestra la dirección y los
botones "Abrir en Google Maps / Waze" (sin la imagen del mapa). Las claves activan el buscador, la dirección automática,
el mapa con pin arrastrable (web) y la imagen del mapa en la página pública.

## Qué hay que hacer (una vez)

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto y **activa la facturación** (Google la
   exige para estas APIs, aunque haya crédito gratuito mensual).
2. En *APIs y servicios → Biblioteca* activa:
   - **Places API (New)** — autocompletado y detalle de lugares (servidor).
   - **Geocoding API** — dirección a partir de un punto (servidor).
   - **Maps Static API** — imagen del mapa de la página pública y del selector nativo (servidor).
   - **Maps JavaScript API** — mapa con pin arrastrable en la app web (navegador).
   - *Maps SDK for Android / Maps SDK for iOS* — **solo** cuando se agregue el mapa nativo con pin arrastrable
     (`react-native-maps`, fase posterior). Hoy iOS/Android no las usan.
3. Crea **dos claves** en *Credenciales* (no reutilices una para todo):

   | Clave | Variable | Se usa en | Restricción de aplicación | Restricción de API |
   |---|---|---|---|---|
   | Servidor | `GOOGLE_MAPS_SERVER_KEY` | `apps/api` (Places, Geocoding, Static Maps) | **Direcciones IP** del servidor de la API | Places API (New), Geocoding API, Maps Static API |
   | Navegador | `GOOGLE_MAPS_BROWSER_KEY` | App web (Maps JavaScript API) | **Sitios web (HTTP referrers)**: `https://tu-dominio.com/*` y, en desarrollo, `http://localhost:8081/*` | Solo Maps JavaScript API |

   - La clave del **servidor nunca sale** de la API: ninguna respuesta ni página la incluye.
   - La clave del **navegador sí viaja** a quien gestiona la página (la entrega `GET /api/booking/places/config`, que exige
     sesión con permiso de gestionar la página). Por eso su restricción por dominio no es opcional.
4. Ponlas en `apps/api/.env` (ver `apps/api/.env.example`) y reinicia la API. Con la clave del navegador la API abre la política
   de seguridad (CSP) de la app web a `maps.googleapis.com` / `maps.gstatic.com`; sin ella la CSP queda como estaba. La página
   pública `/reservar` **nunca** carga scripts de Google (su mapa es una imagen que arma la API).

## Restringir por bundle id (móvil)

Las claves de Maps SDK for Android/iOS (cuando se agregue el mapa nativo) se restringen así:
- **Android**: *Aplicaciones Android* → paquete `com.xirostyle.app` + la huella SHA-1 del certificado de firma (la de EAS y la
  de depuración, por separado).
- **iOS**: *Aplicaciones iOS* → bundle id `com.xirostyle.app`.

Hoy la app nativa **no** usa ninguna clave de Google: pide todo a la API de Xiro (que tiene la del servidor).

## Cómo funciona

- **Buscar**: la app espera 300 ms tras la última tecla y llama a `GET /api/booking/places/autocomplete`. Todo el
  autocompletado y la elección final comparten un *session token* (Google los factura como una sola sesión). Prioriza
  Colombia (sesgo, no filtro) y responde en español.
- **Pin arrastrable (web)**: al soltarlo se guardan las **coordenadas exactas** de donde cayó; solo la dirección se actualiza
  (`GET /api/booking/places/reverse`). En iOS/Android el punto se ajusta buscando, pegando o con "Usar mi ubicación actual".
- **Pegar**: `4.0833, -76.2` · `4°05'00"N 76°12'00"W` · enlaces largos de Google Maps (`@lat,lng`, `!3d…!4d…`, `?q=lat,lng`).
  Los enlaces cortos (`maps.app.goo.gl`) no se pueden leer sin abrirlos: la app pide el enlace largo.
- **Página pública**: `GET /api/public/booking/<slug>/map.png` arma el mapa (oscuro, pin dorado) con las coordenadas
  guardadas —nunca las de la petición— y lo entrega con caché de 1 hora en el navegador.
- **Límites**: las rutas de lugares tienen tope por negocio (90/min) además del límite normal por usuario.

## Costos y buenas prácticas

- Cada vista de la página pública pide una imagen a Static Maps (con caché de 1 h por navegador). Si el tráfico crece,
  pon un CDN delante de `/api/public/booking/*/map.png`.
- Google restringe guardar su contenido de mapa: el servidor **no** almacena las imágenes (solo lat/lng, dirección y `place_id`).
- Configura una **alerta de presupuesto** en Google Cloud para no llevarte sorpresas.

## Permisos del dispositivo

`expo-location` (nativo) pide el permiso "mientras se usa la app" solo al pulsar "Usar mi ubicación actual"; el texto está en
`apps/mobile/app.json`. **Agregar `expo-location` obliga a generar un build nativo nuevo** (Expo Go ya lo incluye). En web, el
navegador muestra su propio aviso y solo funciona en HTTPS o `localhost`.
