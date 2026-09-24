import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

function scryptAsync(password: string, salt: Buffer, params: { N: number; r: number; p: number; keylen: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

/** Hash de referencia para igualar el tiempo de respuesta cuando el usuario no existe. */
export const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'negocio';
}

/**
 * Contador de ventana fija en memoria (una instancia del servidor). Sirve para limitar intentos por clave
 * (cuenta, usuario…). Con varias instancias cada una cuenta por separado: para límites globales exactos,
 * sustituir por un almacén compartido (Redis).
 */
export class WindowCounter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  /** Registra un intento y devuelve cuántos lleva la ventana actual. */
  hit(key: string): number {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count;
  }

  count(key: string): number {
    const bucket = this.buckets.get(key);
    return bucket && bucket.resetAt > this.now() ? bucket.count : 0;
  }

  /** Segundos hasta que se libere la clave (para Retry-After). */
  retryAfterSeconds(key: string): number {
    const bucket = this.buckets.get(key);
    return bucket ? Math.max(1, Math.ceil((bucket.resetAt - this.now()) / 1000)) : 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    // Si aún está lleno (ataque con claves únicas), se descarta lo más antiguo para acotar la memoria.
    if (this.buckets.size >= this.maxKeys) {
      for (const key of Array.from(this.buckets.keys()).slice(0, Math.ceil(this.maxKeys / 10))) this.buckets.delete(key);
    }
  }
}
