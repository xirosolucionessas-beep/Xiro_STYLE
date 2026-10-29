import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Contraseñas: argon2id con cola acotada y verificación de los hashes scrypt anteriores (ver passwords.ts).
export { DUMMY_HASH, hashPassword, needsRehash, verifyPassword } from './passwords';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Token que se puede volver a calcular (HMAC-SHA256 con un secreto del servidor) en vez de sortearlo: permite devolver el MISMO
 * enlace de gestión al repetirse una confirmación idempotente sin guardar el enlace en claro. Sin el secreto es tan impredecible
 * como uno aleatorio (43 caracteres, 256 bits); las partes se separan con un byte nulo para que ("ab","c") y ("a","bc") no coincidan.
 */
export function deriveToken(secret: string, ...parts: string[]): string {
  return createHmac('sha256', secret).update(parts.join('\u0000')).digest('base64url');
}

export function sixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Sin caracteres ambiguos (0/O, 1/I/l…): para que se pueda leer o copiar a mano sin dudas, p. ej. una contraseña
 * temporal que el dueño del negocio le entrega a un cliente. */
const UNAMBIGUOUS_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function readableTempPassword(length = 10): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += UNAMBIGUOUS_CHARS[randomInt(0, UNAMBIGUOUS_CHARS.length)];
  return out;
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * Compara dos secretos en tiempo constante SIN revelar su longitud: se comparan sus HMAC (siempre 32 bytes) con una
 * clave aleatoria del proceso, en vez de los textos (timingSafeEqual exige igual longitud y la longitud se filtraría).
 */
const SECRET_COMPARE_KEY = randomBytes(32);
export function safeEqualSecret(provided: string, expected: string): boolean {
  const a = createHmac('sha256', SECRET_COMPARE_KEY).update(provided).digest();
  const b = createHmac('sha256', SECRET_COMPARE_KEY).update(expected).digest();
  return timingSafeEqual(a, b);
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
