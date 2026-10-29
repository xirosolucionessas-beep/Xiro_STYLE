import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { assertStartupReady, loadConfig } from '../src/config';
import { redactUrl } from '../src/logging';
import { createNotifier, maskDestination } from '../src/notifier';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Fase 2, punto 8: nada sensible en los logs y, en producción, nunca el notificador de consola. */

describe('redacción de URLs', () => {
  it('enmascara el token de gestión de una cita y los parámetros con credenciales', () => {
    expect(redactUrl('/api/public/booking/mi-negocio/appointments/AbC123secreto/cancel')).toBe('/api/public/booking/mi-negocio/appointments/[redactado]/cancel');
    expect(redactUrl('/reservar/mi-negocio/gestion/AbC123secreto')).toBe('/reservar/mi-negocio/gestion/[redactado]');
    expect(redactUrl('/api/booking/events?ticket=tkt_secreto&x=1')).toBe('/api/booking/events?ticket=[redactado]&x=1');
    expect(redactUrl('/algo?token=1&code=123456&password=x')).toBe('/algo?token=[redactado]&code=[redactado]&password=[redactado]');
    // Fase 4: enlaces de lista de espera y de reseña.
    expect(redactUrl('/api/public/booking/mi-negocio/waitlist/AbC123secreto/cancel')).toBe('/api/public/booking/mi-negocio/waitlist/[redactado]/cancel');
    expect(redactUrl('/api/public/booking/mi-negocio/review-link/id.firma')).toBe('/api/public/booking/mi-negocio/review-link/[redactado]');
    expect(redactUrl('/reservar/mi-negocio/espera/AbC123secreto')).toBe('/reservar/mi-negocio/espera/[redactado]');
    expect(redactUrl('/reservar/mi-negocio/resena/id.firma')).toBe('/reservar/mi-negocio/resena/[redactado]');
    expect(redactUrl('/api/clients?q=ana')).toBe('/api/clients?q=ana'); // lo normal no se toca
  });

  it('enmascara el destino de los mensajes de desarrollo', () => {
    expect(maskDestination('ana@correo.com')).toBe('an***@correo.com');
    expect(maskDestination('573001234567')).toBe('57******4567');
  });
});

describe('notificador', () => {
  it('en producción la API no arranca con el notificador de consola (los códigos irían a los logs)', () => {
    const env = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@db:5432/x', REDIS_URL: 'rediss://r:6379', S3_ENDPOINT: 'https://c.r2.cloudflarestorage.com', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' } as NodeJS.ProcessEnv;
    expect(() => assertStartupReady(loadConfig(env))).toThrow(/NOTIFIER_PROVIDER=console/);
    expect(() => assertStartupReady(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv))).not.toThrow(); // en desarrollo sí
    expect(() => loadConfig({ ...env, NOTIFIER_PROVIDER: 'otro' })).toThrow();
    expect(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).notifications.provider).toBe('console');
  });

  it('el de desarrollo enmascara el destino', async () => {
    const lines: string[] = [];
    await createNotifier({ notifications: { provider: 'console' } }, (line) => lines.push(line)).sendOtp({ channel: 'email', to: 'ana@correo.com', code: '123456', purpose: 'recover' } as never);
    expect(lines[0]).toContain('an***@correo.com');
    expect(lines[0]).not.toContain('ana@correo.com');
  });
});

describe('logs de la API real sin secretos', () => {
  let app: FastifyInstance;
  let testDb: TestDatabase;
  let cleanup: () => void;
  const stream = new PassThrough();
  const lines: string[] = [];
  stream.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').split('\n').filter(Boolean)));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const created = testAppConfig();
    cleanup = created.cleanup;
    app = await buildApp({ db: testDb.db, config: created.config, logStream: stream });
  });
  afterAll(async () => {
    await app.close();
    cleanup();
    await testDb.drop();
  });

  it('no registra Authorization, cookies, X-Admin-Secret, tokens de cita ni tickets', async () => {
    const SECRETS = ['Bearer-SECRETO-JWT', 'cookie-SECRETA', 'admin-SECRETO-cabecera', 'TOKENDECITASECRETO', 'TICKETSECRETO'];
    await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${SECRETS[0]}`, cookie: `xiro_client=${SECRETS[1]}` } });
    await app.inject({ method: 'POST', url: '/api/admin/subscription/confirm-bank-transfer', headers: { 'x-admin-secret': SECRETS[2] }, payload: {} });
    await app.inject({ method: 'GET', url: `/api/public/booking/no-existe/appointments/${SECRETS[3]}` });
    await app.inject({ method: 'GET', url: `/api/booking/events?ticket=${SECRETS[4]}` });
    await new Promise((resolve) => setImmediate(resolve));
    const log = lines.join('\n');
    expect(lines.length).toBeGreaterThan(4); // de verdad se registró algo
    for (const secret of SECRETS) expect(log).not.toContain(secret);
    expect(log).toContain('[redactado]');
  });
});
