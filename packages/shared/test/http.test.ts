import { describe, expect, it } from 'vitest';
import { backoffDelay, HTTP_MAX_ATTEMPTS, isIdempotentMethod, isRetriableStatus, withRetry } from '../src/http';

const transient = new Error('sin conexión');
const fatal = new Error('error de programación');
const isTransient = (error: unknown) => error === transient;

/** Ejecuta `withRetry` con respuestas/errores guionizados, sin esperas reales; devuelve el resultado y los intentos. */
async function run(method: string, script: Array<number | Error>) {
  let calls = 0;
  const sleeps: number[] = [];
  const attempt = async () => {
    const step = script[Math.min(calls, script.length - 1)]!;
    calls += 1;
    if (step instanceof Error) throw step;
    return { status: step };
  };
  try {
    const response = await withRetry(method, attempt, (r) => r.status, isTransient, { sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 });
    return { status: response.status, calls, sleeps };
  } catch (error) {
    return { error, calls, sleeps };
  }
}

describe('política de reintentos', () => {
  it('solo GET/HEAD son idempotentes', () => {
    expect(isIdempotentMethod(undefined)).toBe(true);
    expect(isIdempotentMethod('get')).toBe(true);
    expect(isIdempotentMethod('HEAD')).toBe(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isIdempotentMethod(method)).toBe(false);
  });

  it('solo 502/503/504 son transitorios (nunca un 4xx, tampoco 429)', () => {
    expect([502, 503, 504].every(isRetriableStatus)).toBe(true);
    expect([200, 400, 401, 403, 404, 409, 422, 429, 500].some(isRetriableStatus)).toBe(false);
  });

  it('un GET se reintenta ante 503 y sin conexión, hasta 3 intentos en total', async () => {
    expect(await run('GET', [503, 200])).toMatchObject({ status: 200, calls: 2 });
    expect(await run('GET', [transient, transient, 200])).toMatchObject({ status: 200, calls: 3 });
    // Agotados los intentos: devuelve la última respuesta (el cliente la convierte en error) o relanza la excepción.
    expect(await run('GET', [503])).toMatchObject({ status: 503, calls: HTTP_MAX_ATTEMPTS });
    expect(await run('GET', [transient])).toMatchObject({ error: transient, calls: HTTP_MAX_ATTEMPTS });
  });

  it('nunca reintenta un 4xx, otros 5xx ni errores que no son de red', async () => {
    for (const status of [400, 401, 404, 409, 429, 500]) expect(await run('GET', [status, 200])).toMatchObject({ status, calls: 1 });
    expect(await run('GET', [fatal, 200])).toMatchObject({ error: fatal, calls: 1 });
  });

  it('nunca reintenta peticiones que modifican datos (POST/PUT/PATCH/DELETE)', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(await run(method, [503, 200])).toMatchObject({ status: 503, calls: 1, sleeps: [] });
      expect(await run(method, [transient, 200])).toMatchObject({ error: transient, calls: 1 });
    }
  });

  it('espera exponencial con jitter y tope, nunca 0', () => {
    expect([1, 2, 3].map((retry) => backoffDelay(retry, () => 0))).toEqual([200, 400, 800]);
    expect([1, 2, 3].map((retry) => backoffDelay(retry, () => 1))).toEqual([400, 800, 1600]);
    expect(backoffDelay(20, () => 1)).toBe(4_000);
  });

  it('entre intentos espera según el backoff', async () => {
    expect((await run('GET', [503, 503, 200])).sleeps).toEqual([300, 600]);
  });
});
