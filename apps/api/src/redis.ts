import { Redis } from 'ioredis';

/**
 * Cliente de Redis (límites de abuso compartidos entre instancias y caché de las páginas públicas). Pensado para fallar
 * rápido: cada comando reintenta poco y, sin conexión, los comandos fallan de inmediato (sin cola offline) para que los
 * llamadores usen su respaldo (memoria en los límites, la base de datos en la caché) en vez de quedarse esperando.
 */
export function createRedis(url: string, onError: (error: Error) => void): Redis {
  const redis = new Redis(url, {
    lazyConnect: false,
    connectTimeout: 5_000,
    commandTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // Reconexión con espera creciente (tope 5 s): una caída de Redis no se convierte en una tormenta de conexiones.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    connectionName: 'xiro-api',
  });
  redis.on('error', onError);
  return redis;
}

/** Comprobación para /ready: true si Redis responde a PING a tiempo. */
export async function redisHealthy(redis: Redis): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
