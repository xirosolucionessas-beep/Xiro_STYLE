import { HTTP_TIMEOUT_MS } from '@xiro/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: null } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const { ApiError, configureSession, errorKey, request, setAccessToken } = await import('../src/lib/api');

/**
 * Cliente HTTP de la app y el panel web (lib/api.ts) con la política de @xiro/shared/http: tiempo máximo por intento,
 * reintentos SOLO en GET ante fallas transitorias y nunca un 4xx. Se simula `fetch`; los temporizadores son falsos.
 */
const json = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Ejecuta la petición avanzando los temporizadores (esperas entre reintentos y timeouts) hasta que termine. */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const outcome = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  return outcome;
}

describe('cliente HTTP (timeout y reintentos)', () => {
  it('un GET que responde 503 se reintenta y termina bien', async () => {
    fetchMock.mockResolvedValueOnce(json(503)).mockResolvedValueOnce(json(200, { ok: true }));
    const { value } = await settle(request<{ ok: boolean }>('/api/me', { auth: false }));
    expect(value).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sin conexión: 3 intentos y luego offline_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const { error } = await settle(request('/api/me', { auth: false }));
    expect(error).toBeInstanceOf(ApiError);
    expect(errorKey(error)).toBe('offline_error');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('un servidor que no responde se corta a los 15 s con timeout_error (status 0: no cierra la sesión)', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const { error } = await settle(request('/api/me', { auth: false }));
    expect(errorKey(error)).toBe('timeout_error');
    expect((error as InstanceType<typeof ApiError>).status).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(HTTP_TIMEOUT_MS).toBe(15_000);
  });

  it('nunca reintenta un 4xx', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 'not_found' }));
    const { error } = await settle(request('/api/clients/x', { auth: false }));
    expect(errorKey(error)).toBe('not_found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('nunca repite una petición que modifica datos (una venta o una cita no se crean dos veces)', async () => {
    fetchMock.mockResolvedValueOnce(json(503)).mockResolvedValueOnce(json(201, { id: 'venta' }));
    const { error } = await settle(request('/api/sales', { method: 'POST', body: { total: 1 }, auth: false }));
    expect(error).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cada intento lleva su propia señal de cancelación', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await settle(request('/api/me', { auth: false }));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init).not.toHaveProperty('auth');
  });
});

/** Fase 3: en web el refresh token va en una cookie HttpOnly; JavaScript nunca lo tiene. */
describe('panel web: sesión en cookie HttpOnly', () => {
  afterEach(() => {
    configureSession(null);
    setAccessToken(null);
  });

  it('un 401 se renueva con la cookie (sin token en el cuerpo) y reintenta; las rutas que no son /api/auth no llevan credenciales', async () => {
    const onTokens = vi.fn();
    configureSession({ getRefreshToken: () => null, remembers: () => false, onTokens, onSignedOut: vi.fn() });
    setAccessToken('vencido');
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'unauthorized' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'nuevo', refreshToken: '', user: {}, business: {} }))
      .mockResolvedValueOnce(json(200, { data: [], nextCursor: null }));
    const { value } = await settle(request('/api/clients'));
    expect(value).toEqual({ data: [], nextCursor: null });

    const [firstUrl, firstInit] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(firstUrl).toContain('/api/clients');
    expect(firstInit.credentials).toBeUndefined();

    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1]! as [string, RequestInit];
    expect(refreshUrl).toContain('/api/auth/refresh');
    expect(refreshInit.credentials).toBe('include');
    expect(refreshInit.body).toBe('{}');
    const headers = new Headers(refreshInit.headers);
    expect(headers.get('X-Xiro-Session')).toBe('cookie');
    expect(headers.get('X-Xiro-Remember')).toBe('0');
    expect(onTokens).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'nuevo', refreshToken: '' }));
  });
});
