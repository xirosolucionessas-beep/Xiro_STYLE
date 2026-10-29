import type { AuthSession } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Notifier } from '../src/notifier';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Fase 2, punto 9: imágenes servidas desde el almacén con cabeceras seguras, cuota diaria por negocio y R2 en producción. */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanup: () => void;
const notifier: Notifier = { sendOtp: async () => undefined, sendAppointmentReminder: async () => undefined };

beforeAll(async () => {
  testDb = await createTestDatabase();
  const created = testAppConfig({ rateLimit: { enabled: true, globalPerMinute: 10_000, userPerMinute: 10_000, authPerMinute: 1_000 } });
  cleanup = created.cleanup;
  app = await buildApp({ db: testDb.db, notifier, config: { ...created.config, mediaUploadsPerDay: 2 } });
});
afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

async function register(): Promise<AuthSession> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: `Media ${Date.now()}`, businessType: 'beauty_salon', email: `media${Date.now()}${Math.random()}@correo.com`, password: 'Secreta123', acceptTerms: true, language: 'es' } });
  expect(res.statusCode).toBe(201);
  return res.json<AuthSession>();
}

function multipart(file: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----xiro-test-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('ruta /media', () => {
  it('sirve una imagen subida con cabeceras seguras, caché inmutable y ETag/304', async () => {
    const session = await register();
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#09f' } }).png().toBuffer();
    const { payload, headers } = multipart(png);
    const upload = await app.inject({ method: 'PUT', url: '/api/me/photo', payload, headers: { ...headers, authorization: `Bearer ${session.accessToken}` } });
    expect(upload.statusCode).toBe(200);
    const url = upload.json<{ photoUrl: string }>().photoUrl;
    expect(url).toMatch(/^\/media\/[0-9a-f-]{36}\.webp$/);

    const image = await app.inject({ method: 'GET', url });
    expect(image.statusCode).toBe(200);
    expect(image.headers).toMatchObject({ 'content-type': 'image/webp', 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=31536000, immutable' });
    expect(String(image.headers['content-security-policy'])).toContain('sandbox');
    const etag = String(image.headers.etag);
    expect((await app.inject({ method: 'GET', url, headers: { 'if-none-match': etag } })).statusCode).toBe(304);
  });

  it('404 para nombres que no generó la API o intentos de salir de la carpeta', async () => {
    for (const url of ['/media/..%2F..%2Fpackage.json', '/media/archivo.svg', '/media/00000000-0000-4000-8000-000000000000.png', '/media/%2e%2e%2fsecreto']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('cuota diaria de subidas por negocio', () => {
  it('al pasar el tope responde 429 con Retry-After (todas las personas del negocio juntas)', async () => {
    const session = await register();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } }).png().toBuffer();
    const send = () => {
      const { payload, headers } = multipart(png);
      return app.inject({ method: 'PUT', url: '/api/me/photo', payload, headers: { ...headers, authorization: `Bearer ${session.accessToken}` } });
    };
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    const third = await send();
    expect(third.statusCode).toBe(429);
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('configuración del almacén', () => {
  const prod = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@db:5432/x', REDIS_URL: 'rediss://r:6379' } as NodeJS.ProcessEnv;
  it('en producción exige S3/R2 con todas sus credenciales', () => {
    expect(() => loadConfig({ ...prod, MEDIA_STORAGE: 'local' })).toThrow(/S3\/R2/);
    expect(() => loadConfig({ ...prod, MEDIA_STORAGE: 's3', S3_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com' })).toThrow(/S3_BUCKET/);
    // Con todo configurado, producción usa R2 (región "auto" por defecto).
    expect(loadConfig({ ...prod, S3_ENDPOINT: 'https://c.r2.cloudflarestorage.com', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }).media).toMatchObject({ storage: 's3', region: 'auto', bucket: 'b' });
  });
});
