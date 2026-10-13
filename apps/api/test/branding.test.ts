import { brandAccent, type BookingAdminSettings, type PublicBookingProfile, type PublicCatalog } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { businessPublicProfiles } from '../src/db/schema';
import { auth, setupBiz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Fase 3 del plan: cada negocio pone SU marca en su página (acento, título, avisos de confianza), sin datos fijos en el código. */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

describe('marca del negocio en su página pública', () => {
  it('por defecto: sin acento (dorado), sin título propio y sin avisos', async () => {
    const biz = await setupBiz(app, 'Marca por defecto');
    expect((await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>()).toMatchObject({ accentColor: null, bookingTitle: '', trustBadges: [] });
  });

  it('el negocio guarda su acento (normalizado), título y hasta 3 avisos; la página pública y el panel los ven', async () => {
    const biz = await setupBiz(app, 'Con marca');
    const res = await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { accentColor: '#1F4E79', bookingTitle: '  Tu momento  ', trustBadges: ['Sin pago anticipado', 'Reserva con tranquilidad'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json<BookingAdminSettings>().profile).toMatchObject({ accentColor: '#1f4e79', bookingTitle: 'Tu momento', trustBadges: ['Sin pago anticipado', 'Reserva con tranquilidad'] });
    expect((await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>()).toMatchObject({ accentColor: '#1f4e79', bookingTitle: 'Tu momento' });
    // Lo demás del perfil no se tocó (los cambios son parciales).
    expect(res.json<BookingAdminSettings>().profile.published).toBe(true);
    // Volver al dorado por defecto.
    expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { accentColor: null } })).json<BookingAdminSettings>().profile.accentColor).toBeNull();
  });

  it('rechaza un color mal formado, más de 3 avisos, avisos vacíos o un título demasiado largo (400)', async () => {
    const biz = await setupBiz(app, 'Validación marca');
    for (const payload of [{ accentColor: 'red' }, { accentColor: '#12345' }, { accentColor: 'url(javascript:alert(1))' }, { trustBadges: ['a', 'b', 'c', 'd'] }, { trustBadges: ['  '] }, { bookingTitle: 'x'.repeat(61) }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('el catálogo completo (/catalog) usa la misma marca y lleva a la página de reservas SOLO si está publicada', async () => {
    const biz = await setupBiz(app, 'Catálogo marca');
    await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { accentColor: '#2e7d5b' } });
    const data = (await app.inject({ method: 'GET', url: `/api/public/catalog/${biz.slug}` })).json<PublicCatalog>();
    expect(data.business.brand).toEqual(brandAccent('#2e7d5b'));
    expect(data.business.bookingPath).toBe(`/reservar/${biz.slug}`);
    await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { published: false } });
    const hidden = (await app.inject({ method: 'GET', url: `/api/public/catalog/${biz.slug}` })).json<PublicCatalog>();
    expect(hidden.business.bookingPath).toBeNull();
    expect(hidden.items.length).toBeGreaterThan(0); // el catálogo sigue mostrando todo lo publicado
    // La página HTML del catálogo permite la tipografía del rediseño y nada más externo.
    const page = await app.inject({ method: 'GET', url: `/catalog/${biz.slug}` });
    expect(page.headers['content-security-policy']).toContain('font-src https://fonts.gstatic.com');
    expect(page.headers['content-security-policy']).toContain("script-src 'self';");
  });

  it('la propia base de datos rechaza un color mal formado aunque el código fallara (CSS seguro en la página)', async () => {
    const biz = await setupBiz(app, 'Base marca');
    await expect(testDb.db.update(businessPublicProfiles).set({ accentColor: '#fff;}body{display:none' }).where(eq(businessPublicProfiles.businessId, biz.session.business.id))).rejects.toMatchObject({ cause: { code: '23514' } });
  });
});
