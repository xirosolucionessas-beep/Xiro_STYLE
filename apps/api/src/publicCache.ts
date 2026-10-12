import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Caché de las lecturas PÚBLICAS (página de reservas y catálogo compartido): las mismas respuestas para cualquier
 * visitante, sin sesión ni datos privados. Nunca se guarda nada que dependa de quién pregunta.
 *
 * Invalidación por versión: cada negocio tiene una versión (un valor aleatorio); las entradas se guardan bajo
 * `negocio + versión + nombre`. Cualquier escritura exitosa de ese negocio (app.ts) le pone una versión nueva y las
 * entradas viejas dejan de leerse al instante (y caducan solas por TTL). La versión se lee ANTES de calcular: si una
 * escritura ocurre mientras se calcula, el resultado queda bajo la versión vieja y nadie lo vuelve a leer. Es aleatoria
 * (no un contador) para que, si Redis expulsa la clave de versión, la nueva nunca coincida con entradas anteriores.
 *
 * Con Redis la caché es compartida entre instancias; si Redis falla se calcula directo (sin caché) — nunca se cae a
 * memoria, porque cada instancia tendría su copia y una escritura en una no invalidaría las demás. Sin Redis
 * (desarrollo, una sola instancia) usa memoria del proceso con un tope de tamaño.
 */
export interface CacheBackend {
  readonly kind: 'redis' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Guarda solo si no existe; devuelve el valor que quedó (el propio o el que ya estaba). */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<string>;
}

const PREFIX = 'xiro:pc:';
/** Las versiones duran más que cualquier entrada. */
const VERSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export class RedisCacheBackend implements CacheBackend {
  readonly kind = 'redis' as const;
  constructor(private readonly redis: Redis) {}
  get(key: string) {
    return this.redis.get(PREFIX + key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(PREFIX + key, value, 'EX', ttlSeconds);
  }
  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(PREFIX + key, value, 'EX', ttlSeconds, 'NX');
    return (await this.redis.get(PREFIX + key)) ?? value;
  }
}

/** Memoria del proceso con tope en bytes (aprox. 2 bytes por carácter): al pasarlo se descartan las entradas más viejas. */
export class MemoryCacheBackend implements CacheBackend {
  readonly kind = 'memory' as const;
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private bytes = 0;
  constructor(private readonly maxBytes = 16 * 1024 * 1024) {}

  async get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    const size = value.length * 2;
    if (size > this.maxBytes / 4) return; // una sola entrada no puede desplazar media caché
    this.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.bytes += size;
    for (const oldest of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(oldest);
    }
  }
  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    const current = await this.get(key);
    if (current !== null) return current;
    await this.set(key, value, ttlSeconds);
    return value;
  }
  private delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.value.length * 2;
    this.entries.delete(key);
  }
}

export class PublicCache {
  constructor(
    private readonly backend: CacheBackend | null,
    /** TTL máximo de las entradas (PUBLIC_CACHE_TTL_SECONDS); 0 o sin backend = caché apagada. */
    readonly ttlSeconds: number,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  get enabled(): boolean {
    return this.backend !== null && this.ttlSeconds > 0;
  }

  /**
   * Devuelve lo guardado para `businessId/name` o lo calcula y lo guarda. `name` debe identificar TODO lo que cambia la
   * respuesta (ruta y parámetros normalizados). Si `compute` lanza (404, error), no se guarda nada.
   */
  async wrap<T>(businessId: string, name: string, compute: () => Promise<T>, ttlSeconds = this.ttlSeconds): Promise<T> {
    const backend = this.backend;
    const ttl = Math.min(ttlSeconds, this.ttlSeconds);
    if (!backend || ttl <= 0) return compute();
    let key: string;
    try {
      const version = (await backend.get(versionKey(businessId))) ?? (await backend.setIfAbsent(versionKey(businessId), newVersion(), VERSION_TTL_SECONDS));
      key = `e:${businessId}:${version}:${name}`;
      const hit = await backend.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (error) {
      this.onError(error);
      return compute();
    }
    const value = await compute();
    try {
      await backend.set(key, JSON.stringify(value), ttl);
    } catch (error) {
      this.onError(error);
    }
    return value;
  }

  /** Invalida todo lo guardado de un negocio. Nunca lanza: un fallo de Redis no debe tumbar la escritura que ya se hizo. */
  async invalidate(businessId: string): Promise<void> {
    if (!this.backend) return;
    try {
      await this.backend.set(versionKey(businessId), newVersion(), VERSION_TTL_SECONDS);
    } catch (error) {
      this.onError(error);
    }
  }
}

const versionKey = (businessId: string) => `v:${businessId}`;
const newVersion = () => randomBytes(9).toString('base64url');
