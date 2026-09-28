import type { PickedLocation, PlaceSuggestion, PlacesConfig, ReverseGeocodeResult } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PLACE_ID, SESSION_TOKEN } from '../booking/google';
import type { GoogleMaps } from '../booking/google';
import type { Ctx } from '../context';
import { AppError, parse } from '../errors';
import { WindowCounter } from '../security';

const language = z.enum(['es', 'en']).default('es');
// El token de sesión agrupa las teclas de una búsqueda y su selección en UNA sola facturación en Google (Places API New).
const sessionToken = z.string().regex(SESSION_TOKEN);
const autocompleteQuery = z.object({ q: z.string().trim().min(2).max(200), session: sessionToken, lang: language });
const detailsQuery = z.object({ placeId: z.string().regex(PLACE_ID), session: sessionToken, lang: language });
const pointQuery = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), lang: language });

/** Peticiones a Google por negocio y por minuto: un cliente con la pantalla abierta hace decenas (una por pausa al teclear), un abuso, miles. */
const PER_MINUTE_PER_BUSINESS = 90;

/**
 * Buscador de direcciones y mapa para "Mi página web": todas las llamadas a Google salen del servidor con SU clave (la del
 * navegador solo dibuja el mapa y nunca se usa aquí). Rutas autenticadas con el permiso de gestionar la página, límite por negocio
 * y validación estricta de lo que entra (el ID del lugar y el token van dentro de una URL de Google).
 */
export function placesRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { config } = ctx;
  const limiter = new WindowCounter(60_000);

  function client(request: { user: { bid: string } }): GoogleMaps {
    if (!ctx.maps) throw new AppError(503, 'places_not_configured');
    if (config.rateLimit.enabled && limiter.hit(request.user.bid) > PER_MINUTE_PER_BUSINESS) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(limiter.retryAfterSeconds(request.user.bid)) });
    }
    return ctx.maps;
  }

  // Sin clave el cliente lo sabe de antemano y ofrece solo pegar coordenadas en vez de fallar en cada búsqueda.
  app.get('/booking/places/config', async (): Promise<PlacesConfig> => ({ enabled: ctx.maps !== null, browserKey: ctx.maps ? config.booking.googleBrowserKey : null }));

  app.get('/booking/places/autocomplete', async (request): Promise<PlaceSuggestion[]> => {
    const q = parse(autocompleteQuery, request.query);
    return client(request).autocomplete(q.q, q.session, q.lang);
  });

  app.get('/booking/places/details', async (request): Promise<PickedLocation> => {
    const q = parse(detailsQuery, request.query);
    return client(request).details(q.placeId, q.session, q.lang);
  });

  app.get('/booking/places/reverse', async (request): Promise<ReverseGeocodeResult> => {
    const q = parse(pointQuery, request.query);
    return client(request).reverse({ lat: q.lat, lng: q.lng }, q.lang);
  });

  /** Mapa estático para el selector nativo (que no puede dibujar el interactivo): llega como imagen en base64 porque la app
   * no puede pedir un <Image> con el header de sesión. */
  app.get('/booking/places/static-map', async (request): Promise<{ image: string }> => {
    const q = parse(pointQuery, request.query);
    const png = await client(request).staticMap({ lat: q.lat, lng: q.lng }, { width: 640, height: 320 });
    return { image: `data:image/png;base64,${png.toString('base64')}` };
  });
}
