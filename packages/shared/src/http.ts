/**
 * Política de red común a la app (Android/iOS/panel web) y a la página pública de reservas: cuánto esperar una
 * respuesta y qué reintentar. Sin dependencias de plataforma (el temporizador/AbortController lo pone cada cliente).
 *
 * Reglas:
 *  - Solo se reintentan peticiones IDEMPOTENTES (GET/HEAD): reintentar un POST podría crear una venta o una cita dos veces.
 *  - Se reintenta ante fallas transitorias: sin conexión, tiempo agotado o 502/503/504 (servidor reiniciando, balanceador).
 *  - Nunca un 4xx (incluido 429: el servidor pidió esperar) ni otros 5xx.
 *  - Máximo 3 intentos en total, con espera exponencial y jitter (no todos los teléfonos reintentan a la vez).
 */
export const HTTP_TIMEOUT_MS = 15_000;
export const HTTP_MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 4_000;

export const isIdempotentMethod = (method: string | undefined): boolean => {
  const normalized = (method ?? 'GET').toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
};

export const isRetriableStatus = (status: number): boolean => status === 502 || status === 503 || status === 504;

/**
 * Espera antes del reintento número `retry` (1, 2, …): exponencial con tope y "equal jitter" (mitad fija + mitad al
 * azar), así nunca es 0 y los clientes se desincronizan. `random` se inyecta para poder probarlo.
 */
export function backoffDelay(retry: number, random: () => number = Math.random): number {
  const exponential = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, retry - 1));
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

export interface RetryOptions {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

// `setTimeout` existe en todas las plataformas, pero este paquete solo declara ES2022: se toma de globalThis con su tipo mínimo.
const timers = globalThis as unknown as { setTimeout: (callback: () => void, ms: number) => unknown };
const defaultSleep = (ms: number) => new Promise<void>((resolve) => void timers.setTimeout(resolve, ms));

/**
 * Ejecuta `attempt` con la política de arriba. `statusOf` lee el código HTTP de la respuesta; `isTransientError` decide
 * si una excepción (sin conexión, tiempo agotado) merece otro intento. Devuelve la última respuesta (aunque sea un
 * 503 tras agotar los intentos: el llamador la trata como error) o relanza la última excepción.
 */
export async function withRetry<R>(method: string | undefined, attempt: () => Promise<R>, statusOf: (response: R) => number, isTransientError: (error: unknown) => boolean, options: RetryOptions = {}): Promise<R> {
  const maxAttempts = isIdempotentMethod(method) ? Math.max(1, options.maxAttempts ?? HTTP_MAX_ATTEMPTS) : 1;
  const sleep = options.sleep ?? defaultSleep;
  for (let attemptNumber = 1; ; attemptNumber += 1) {
    const last = attemptNumber >= maxAttempts;
    try {
      const response = await attempt();
      if (last || !isRetriableStatus(statusOf(response))) return response;
    } catch (error) {
      if (last || !isTransientError(error)) throw error;
    }
    await sleep(backoffDelay(attemptNumber, options.random));
  }
}
