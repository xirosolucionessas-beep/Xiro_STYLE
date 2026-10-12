import type { Redis } from 'ioredis';
import { WindowCounter } from './security';

/**
 * Contadores de ventana fija para límites de abuso (intentos de inicio de sesión, recuperación de contraseña, reservas
 * públicas, subida de fotos…). Con Redis los comparten TODAS las instancias de la API y sobreviven a un reinicio; sin
 * Redis (desarrollo, pruebas o una sola instancia) se usa memoria del proceso.
 */
export interface RateStore {
  readonly kind: 'redis' | 'memory';
  /** Registra un intento en `key`; devuelve el total de la ventana y los ms que le quedan. */
  hit(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
  peek(key: string): Promise<{ count: number; ttlMs: number }>;
  reset(key: string): Promise<void>;
}

/**
 * INCR + PEXPIRE atómico (un solo viaje a Redis): la ventana arranca con el primer intento y nunca queda una clave sin
 * expiración (si el proceso cae entre ambos comandos no hay "candado eterno").
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return { count, ttl }
`;

export class RedisRateStore implements RateStore {
  readonly kind = 'redis' as const;
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'xiro:rl:',
  ) {}

  async hit(key: string, windowMs: number) {
    const [count, ttlMs] = (await this.redis.eval(HIT_SCRIPT, 1, this.prefix + key, String(windowMs))) as [number, number];
    return { count: Number(count), ttlMs: Number(ttlMs) };
  }

  async peek(key: string) {
    const [count, ttl] = await Promise.all([this.redis.get(this.prefix + key), this.redis.pttl(this.prefix + key)]);
    return { count: count ? Number(count) : 0, ttlMs: ttl > 0 ? ttl : 0 };
  }

  async reset(key: string) {
    await this.redis.del(this.prefix + key);
  }
}

/** Memoria del proceso: misma semántica que Redis, una ventana por clave. Solo para desarrollo o una instancia. */
export class MemoryRateStore implements RateStore {
  readonly kind = 'memory' as const;
  private readonly counters = new Map<number, WindowCounter>();
  private readonly windows = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  private counter(windowMs: number) {
    let counter = this.counters.get(windowMs);
    if (!counter) this.counters.set(windowMs, (counter = new WindowCounter(windowMs, this.now)));
    return counter;
  }

  async hit(key: string, windowMs: number) {
    // Tope de memoria: con claves únicas (ataque) se descartan las que ya no cuentan.
    if (this.windows.size >= 100_000) for (const [k, w] of this.windows) if (this.counter(w).count(k) === 0) this.windows.delete(k);
    this.windows.set(key, windowMs);
    const counter = this.counter(windowMs);
    const count = counter.hit(key);
    return { count, ttlMs: counter.retryAfterSeconds(key) * 1000 };
  }

  async peek(key: string) {
    const windowMs = this.windows.get(key);
    if (windowMs === undefined) return { count: 0, ttlMs: 0 };
    const counter = this.counter(windowMs);
    return { count: counter.count(key), ttlMs: counter.count(key) > 0 ? counter.retryAfterSeconds(key) * 1000 : 0 };
  }

  async reset(key: string) {
    const windowMs = this.windows.get(key);
    if (windowMs !== undefined) this.counter(windowMs).reset(key);
  }
}

/**
 * Un límite con nombre y ventana propios sobre el almacén compartido (cada nombre es su propio espacio de claves:
 * "login" y "booking" no se pisan aunque usen la misma clave).
 */
export class RateLimiter {
  constructor(
    private readonly store: RateStore,
    private readonly name: string,
    private readonly windowMs: number,
  ) {}

  private key(key: string) {
    return `${this.name}:${key}`;
  }

  /** Registra un intento y devuelve cuántos lleva la ventana actual. */
  async hit(key: string): Promise<number> {
    return (await this.store.hit(this.key(key), this.windowMs)).count;
  }

  async count(key: string): Promise<number> {
    return (await this.store.peek(this.key(key))).count;
  }

  /** Segundos hasta que se libere la clave (para Retry-After); mínimo 1. */
  async retryAfterSeconds(key: string): Promise<number> {
    const { ttlMs } = await this.store.peek(this.key(key));
    return Math.max(1, Math.ceil(ttlMs / 1000));
  }

  async reset(key: string): Promise<void> {
    await this.store.reset(this.key(key));
  }
}

/** Fábrica de límites que reciben las rutas por el contexto (\`ctx.rates.limiter('login', 15 * 60_000)\`). */
export class RateLimits {
  constructor(readonly store: RateStore) {}
  limiter(name: string, windowMs: number): RateLimiter {
    return new RateLimiter(this.store, name, windowMs);
  }
}

/**
 * Redis con respaldo en memoria: si Redis falla (caída, red), los límites siguen funcionando por proceso en lugar de
 * dejar de proteger o de tumbar las peticiones. Se avisa una vez por caída y se vuelve a Redis en cuanto responde.
 */
export class FallbackRateStore implements RateStore {
  readonly kind = 'redis' as const;
  private degraded = false;
  constructor(
    private readonly primary: RateStore,
    private readonly fallback: RateStore,
    private readonly onDegraded: (error: unknown) => void,
  ) {}

  private async run<T>(op: (store: RateStore) => Promise<T>): Promise<T> {
    try {
      const result = await op(this.primary);
      this.degraded = false;
      return result;
    } catch (error) {
      if (!this.degraded) this.onDegraded(error);
      this.degraded = true;
      return op(this.fallback);
    }
  }

  hit(key: string, windowMs: number) {
    return this.run((store) => store.hit(key, windowMs));
  }
  peek(key: string) {
    return this.run((store) => store.peek(key));
  }
  reset(key: string) {
    return this.run((store) => store.reset(key));
  }
}
