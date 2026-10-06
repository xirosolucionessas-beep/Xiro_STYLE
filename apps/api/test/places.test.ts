import type { BookingAdminSettings, PickedLocation, PlaceSuggestion, PublicBookingProfile, ReverseGeocodeResult } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { GoogleMapsClient, type GoogleMaps } from '../src/booking/google';
import { AppError } from '../src/errors';
import { auth, createEmployee, setupBiz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

const KEY = 'AIzaSy-CLAVE-SECRETA-DEL-SERVIDOR';
const PLACE = 'ChIJ_lugar_de_prueba_123';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

describe('GoogleMapsClient (contra un fetch simulado)', () => {
  it('autocompleta con la clave en el header (nunca en la URL), sesgo a Colombia, español y token de sesión', async () => {
    const fetcher = vi.fn(async () =>
      json({
        suggestions: [
          { placePrediction: { placeId: PLACE, text: { text: 'Carrera 7 # 71-21, Bogotá' }, structuredFormat: { mainText: { text: 'Carrera 7 # 71-21' }, secondaryText: { text: 'Bogotá, Colombia' } } } },
          { placePrediction: { placeId: 'malo/../id', text: { text: 'Inválido' } } }, // ID con caracteres que no son de Google: se descarta
          { queryPrediction: { text: { text: 'no es un lugar' } } },
        ],
      }),
    );
    const client = new GoogleMapsClient(KEY, fetcher as never);
    expect(await client.autocomplete('carrera 7', 'sesion-1234', 'es')).toEqual([{ placeId: PLACE, text: 'Carrera 7 # 71-21', secondaryText: 'Bogotá, Colombia' }]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe(KEY);
    expect(url).not.toContain(KEY);
    expect(JSON.parse(init.body as string)).toMatchObject({ input: 'carrera 7', sessionToken: 'sesion-1234', languageCode: 'es', regionCode: 'CO', locationBias: { rectangle: { low: { latitude: -4.3 } } } });
  });

  it('detalles: pide solo los campos necesarios y devuelve dirección, coordenadas y lugar', async () => {
    const fetcher = vi.fn(async () => json({ id: PLACE, formattedAddress: 'Cra. 7 #71-21, Bogotá', location: { latitude: 4.6533, longitude: -74.0836 } }));
    const got = await new GoogleMapsClient(KEY, fetcher as never).details(PLACE, 'sesion-1234', 'es');
    expect(got).toEqual({ lat: 4.6533, lng: -74.0836, address: 'Cra. 7 #71-21, Bogotá', placeId: PLACE });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/v1/places/${PLACE}?languageCode=es&sessionToken=sesion-1234`);
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('id,formattedAddress,location');
  });

  it('geocodificación inversa: la dirección más cercana, y "sin resultados" no es un error', async () => {
    const ok = new GoogleMapsClient(KEY, (async () => json({ status: 'OK', results: [{ formatted_address: 'Cra. 7 #71-21', place_id: PLACE }] })) as never);
    expect(await ok.reverse({ lat: 4.65, lng: -74.08 }, 'es')).toEqual({ address: 'Cra. 7 #71-21', placeId: PLACE });
    const sea = new GoogleMapsClient(KEY, (async () => json({ status: 'ZERO_RESULTS', results: [] })) as never);
    expect(await sea.reverse({ lat: 0, lng: -30 }, 'es')).toEqual({ address: '', placeId: null });
  });

  it('un fallo de Google se reporta genérico: nunca se filtra su mensaje (puede nombrar la clave o su restricción)', async () => {
    for (const fetcher of [async () => json({ error: { message: `API key ${KEY} is restricted` } }, { status: 403 }), async () => json({ status: 'REQUEST_DENIED', error_message: `The key ${KEY}...` }), async () => Promise.reject(new Error(`network ${KEY}`))]) {
      const error = await new GoogleMapsClient(KEY, fetcher as never).reverse({ lat: 1, lng: 1 }, 'es').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect((error as AppError).code).toBe('places_upstream_error');
    }
  });

  it('mapa estático: oscuro, con el pin dorado de la marca, centrado en el punto, y exige que la respuesta sea una imagen', async () => {
    const fetcher = vi.fn(async () => new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const png = await new GoogleMapsClient(KEY, fetcher as never).staticMap({ lat: 4.6533, lng: -74.0836 }, { width: 640, height: 360 });
    expect(png.equals(PNG)).toBe(true);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    const params = new URL(url).searchParams;
    expect(params.get('center')).toBe('4.6533,-74.0836');
    expect(params.get('markers')).toBe('color:0xd9b636|4.6533,-74.0836');
    expect(params.getAll('style').length).toBeGreaterThan(5);
    expect(params.get('size')).toBe('640x360');
    const html = new GoogleMapsClient(KEY, (async () => new Response('<html>error</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })) as never);
    await expect(html.staticMap({ lat: 1, lng: 1 }, { width: 10, height: 10 })).rejects.toMatchObject({ code: 'places_upstream_error' });
  });
});

/** Google de mentira: registra lo que se le pidió y responde siempre lo mismo. */
function fakeMaps() {
  const calls: string[] = [];
  const maps: GoogleMaps = {
    async autocomplete(input, session, language) {
      calls.push(`autocomplete:${input}:${session}:${language}`);
      return [{ placeId: PLACE, text: 'Carrera 7 # 71-21', secondaryText: 'Bogotá' }] satisfies PlaceSuggestion[];
    },
    async details(placeId) {
      calls.push(`details:${placeId}`);
      return { lat: 4.6533, lng: -74.0836, address: 'Cra. 7 #71-21, Bogotá', placeId } satisfies PickedLocation;
    },
    async reverse(point) {
      calls.push(`reverse:${point.lat},${point.lng}`);
      return { address: 'Dirección del pin', placeId: PLACE } satisfies ReverseGeocodeResult;
    },
    async staticMap(point) {
      calls.push(`static:${point.lat},${point.lng}`);
      return PNG;
    },
  };
  return { maps, calls };
}

describe('rutas de lugares y mapa', () => {
  let testDb: TestDatabase;
  let cleanup: () => void;
  let app: FastifyInstance; // con Google de mentira
  let bare: FastifyInstance; // sin clave de Google
  const fake = fakeMaps();

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const setup = testAppConfig({ booking: { googleBrowserKey: 'BROWSER-KEY-RESTRINGIDA-POR-DOMINIO', googleServerKey: null } });
    cleanup = setup.cleanup;
    app = await buildApp({ db: testDb.db, config: setup.config, maps: fake.maps });
    bare = await buildApp({ db: testDb.db, config: testAppConfig().config });
  });

  afterAll(async () => {
    await app.close();
    await bare.close();
    cleanup();
    await testDb.drop();
  });

  const get = (biz: { session: Parameters<typeof auth>[0] }, url: string) => app.inject({ method: 'GET', url: `/api/booking/places/${url}`, headers: auth(biz.session) });
  const save = (biz: { session: Parameters<typeof auth>[0] }, body: unknown) => app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: body as object });

  it('buscar, elegir y geocodificar al revés: pasa por el servidor con lo validado y sin exponer la clave del servidor', async () => {
    const biz = await setupBiz(app, 'Lugares');
    const search = await get(biz, 'autocomplete?q=carrera%207&session=sesion-abcd1234&lang=es');
    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual([{ placeId: PLACE, text: 'Carrera 7 # 71-21', secondaryText: 'Bogotá' }]);
    const details = await get(biz, `details?placeId=${PLACE}&session=sesion-abcd1234`);
    expect(details.json()).toMatchObject({ lat: 4.6533, lng: -74.0836, placeId: PLACE });
    const reverse = await get(biz, 'reverse?lat=4.65&lng=-74.08');
    expect(reverse.json()).toEqual({ address: 'Dirección del pin', placeId: PLACE });
    expect(fake.calls).toEqual(expect.arrayContaining(['autocomplete:carrera 7:sesion-abcd1234:es', `details:${PLACE}`, 'reverse:4.65,-74.08']));
    const map = await get(biz, 'static-map?lat=4.65&lng=-74.08');
    expect(map.json<{ image: string }>().image).toMatch(/^data:image\/png;base64,/);
  });

  it('valida lo que entra: texto muy corto, ID de lugar raro (va dentro de una URL de Google), token raro y coordenadas imposibles', async () => {
    const biz = await setupBiz(app, 'Validacion');
    expect((await get(biz, 'autocomplete?q=a&session=sesion-abcd1234')).statusCode).toBe(400);
    expect((await get(biz, 'autocomplete?q=carrera&session=../../x')).statusCode).toBe(400);
    expect((await get(biz, 'details?placeId=../../v1/places&session=sesion-abcd1234')).statusCode).toBe(400);
    expect((await get(biz, 'details?placeId=corto&session=sesion-abcd1234')).statusCode).toBe(400);
    expect((await get(biz, 'reverse?lat=95&lng=10')).statusCode).toBe(400);
    expect((await get(biz, 'reverse?lat=abc&lng=10')).statusCode).toBe(400);
  });

  it('sin sesión 401; un empleado sin permiso de gestionar la página, 403; con el permiso, sí', async () => {
    const biz = await setupBiz(app, 'Permisos');
    expect((await app.inject({ method: 'GET', url: '/api/booking/places/reverse?lat=1&lng=1' })).statusCode).toBe(401);
    const plain = await createEmployee(app, biz.session, []);
    expect((await app.inject({ method: 'GET', url: '/api/booking/places/reverse?lat=1&lng=1', headers: auth(plain.session) })).statusCode).toBe(403);
    const manager = await createEmployee(app, biz.session, ['public_page_manage']);
    expect((await app.inject({ method: 'GET', url: '/api/booking/places/reverse?lat=1&lng=1', headers: auth(manager.session) })).statusCode).toBe(200);
  });

  it('config: con Google informa que está activo y entrega la clave del NAVEGADOR (nunca la del servidor); sin Google, 503 y sin clave', async () => {
    const biz = await setupBiz(app, 'Config');
    const on = await get(biz, 'config');
    expect(on.json()).toEqual({ enabled: true, browserKey: 'BROWSER-KEY-RESTRINGIDA-POR-DOMINIO' });

    const other = await setupBiz(bare, 'Sin google');
    const off = await bare.inject({ method: 'GET', url: '/api/booking/places/config', headers: auth(other.session) });
    expect(off.json()).toEqual({ enabled: false, browserKey: null });
    const search = await bare.inject({ method: 'GET', url: '/api/booking/places/autocomplete?q=carrera&session=sesion-abcd1234', headers: auth(other.session) });
    expect(search.statusCode).toBe(503);
    expect(search.json().code).toBe('places_not_configured');
  });

  it('el pin se guarda con su dirección y lugar, y se ve en la configuración; quitar la ubicación borra también la dirección y el lugar', async () => {
    const biz = await setupBiz(app, 'Pin');
    const saved = await save(biz, { latitude: 4.6533, longitude: -74.0836, mapAddress: '  Cra. 7 #71-21, Bogotá  ', placeId: PLACE });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<BookingAdminSettings>().profile).toMatchObject({ latitude: 4.6533, longitude: -74.0836, mapAddress: 'Cra. 7 #71-21, Bogotá', placeId: PLACE });

    const removed = await save(biz, { latitude: null, longitude: null });
    expect(removed.json<BookingAdminSettings>().profile).toMatchObject({ latitude: null, longitude: null, mapAddress: '', placeId: null });
  });

  it('coordenadas siempre en pareja, y un lugar de Google demasiado largo se rechaza', async () => {
    const biz = await setupBiz(app, 'Pareja');
    expect((await save(biz, { latitude: 4.6 })).statusCode).toBe(400);
    expect((await save(biz, { latitude: 4.6, longitude: -74, placeId: 'x'.repeat(301) })).statusCode).toBe(400);
  });

  it('la página pública muestra pin, dirección y la imagen del mapa (de este mismo servidor) solo si hay pin y clave de Google', async () => {
    const biz = await setupBiz(app, 'Publica');
    const before = (await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>();
    expect(before).toMatchObject({ latitude: null, mapAddress: '', placeId: null, mapImageUrl: null });

    await save(biz, { latitude: 4.6533, longitude: -74.0836, mapAddress: 'Cra. 7 #71-21, Bogotá', placeId: PLACE });
    const after = (await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>();
    expect(after).toMatchObject({ latitude: 4.6533, longitude: -74.0836, mapAddress: 'Cra. 7 #71-21, Bogotá', placeId: PLACE });
    expect(after.mapImageUrl).toBe(`/api/public/booking/${biz.slug}/map.png?v=4.6533,-74.0836`);
    expect(JSON.stringify(after)).not.toContain('AIzaSy'); // ninguna clave en la respuesta pública

    // Sin clave de Google en el servidor: hay pin y dirección, pero no imagen (la página muestra solo dirección y botones).
    const other = await setupBiz(bare, 'Sin imagen');
    await bare.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(other.session), payload: { latitude: 4.6, longitude: -74.1, mapAddress: 'X' } });
    expect((await bare.inject({ method: 'GET', url: other.base })).json<PublicBookingProfile>()).toMatchObject({ latitude: 4.6, mapImageUrl: null });
  });

  it('map.png: la imagen sale con caché de una hora y usa las coordenadas GUARDADAS, no las de la petición', async () => {
    const biz = await setupBiz(app, 'Imagen');
    await save(biz, { latitude: 4.6533, longitude: -74.0836 });
    fake.calls.length = 0;
    const res = await app.inject({ method: 'GET', url: `${biz.base}/map.png?v=1,1&lat=10&lng=10&center=99,99` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(fake.calls).toEqual(['static:4.6533,-74.0836']);
  });

  it('map.png responde 404 igual si no hay pin, si la sección del mapa está apagada, si la página no está publicada o no existe', async () => {
    const noPin = await setupBiz(app, 'Sin pin');
    expect((await app.inject({ method: 'GET', url: `${noPin.base}/map.png` })).statusCode).toBe(404);

    const off = await setupBiz(app, 'Mapa apagado');
    await save(off, { latitude: 4.6, longitude: -74.1, sections: { map: false } });
    expect((await app.inject({ method: 'GET', url: `${off.base}/map.png` })).statusCode).toBe(404);

    const hidden = await setupBiz(app, 'Oculto');
    await save(hidden, { latitude: 4.6, longitude: -74.1 });
    await save(hidden, { published: false });
    expect((await app.inject({ method: 'GET', url: `${hidden.base}/map.png` })).statusCode).toBe(404);

    expect((await app.inject({ method: 'GET', url: '/api/public/booking/no-existe-este-negocio/map.png' })).statusCode).toBe(404);

    const noKey = await setupBiz(bare, 'Sin clave');
    await bare.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(noKey.session), payload: { latitude: 4.6, longitude: -74.1 } });
    expect((await bare.inject({ method: 'GET', url: `${noKey.base}/map.png` })).statusCode).toBe(404);
  });
});
