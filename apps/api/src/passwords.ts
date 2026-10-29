import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify, type Algorithm } from '@node-rs/argon2';
import { AppError } from './errors';

/**
 * Contraseñas: argon2id (recomendación de OWASP) con los parámetros de referencia m=19 MiB, t=2, p=1 (~30 ms por hash
 * medido en el equipo de desarrollo). Los hashes scrypt anteriores se siguen verificando y se re-hashean a argon2id en
 * el siguiente inicio de sesión correcto (\`needsRehash\`), sin pedirle nada a nadie.
 *
 * Tanto scrypt como argon2 corren en el threadpool de libuv (el mismo que usan el disco y la resolución DNS). Una ráfaga
 * de inicios de sesión lo saturaba y frenaba TODO el servidor; por eso cada hash pasa por una cola con un número
 * acotado de trabajos simultáneos y una fila de espera con tope: si la fila se llena, se responde 503 (\`server_busy\`)
 * en vez de acumular memoria hasta caerse.
 */
// `Algorithm` es un const enum (no usable como valor con isolatedModules): 2 = Argon2id en @node-rs/argon2.
const ARGON2 = { algorithm: 2 as Algorithm, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/* ---------- Cola de hashing ---------- */

let concurrency = 2;
let maxQueue = 200;
let running = 0;
const waiting: Array<() => void> = [];

/** Ajusta la cola (lo llama buildApp con la configuración). */
export function configurePasswordHashing(options: { concurrency: number; maxQueue: number }): void {
  concurrency = Math.max(1, options.concurrency);
  maxQueue = Math.max(0, options.maxQueue);
}

/** Estado de la cola (métricas / pruebas). */
export const passwordQueueStats = () => ({ running, waiting: waiting.length, concurrency, maxQueue });

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running < concurrency) running += 1;
  else {
    if (waiting.length >= maxQueue) throw new AppError(503, 'server_busy', undefined, { 'Retry-After': '2' });
    // El lugar se recibe ya ocupado (ver \`finally\`): nunca hay más de \`concurrency\` trabajos a la vez.
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await task();
  } finally {
    // Se le pasa el lugar directamente al siguiente en espera (sin liberarlo): así ninguna petición nueva se cuela
    // entre la liberación y el despertar del que esperaba.
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/* ---------- scrypt (solo para verificar hashes anteriores) ---------- */

function scryptAsync(password: string, salt: Buffer, params: { N: number; r: number; p: number; keylen: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    // maxmem holgado: N=16384, r=8 necesita ~16 MiB (el límite por defecto de Node es 32 MiB).
    scrypt(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const [, n, r, p, saltB64, keyB64] = stored.split('$');
  if (!n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), { N: Number(n), r: Number(r), p: Number(p), keylen: expected.length });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---------- API pública ---------- */

export function hashPassword(password: string): Promise<string> {
  return limited(() => argon2Hash(password, ARGON2));
}

/** Verifica contra argon2id (actual) o scrypt (anterior). Un hash con formato desconocido nunca valida. */
export function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$argon2')) return limited(() => argon2Verify(stored, password).catch(() => false));
  if (stored.startsWith('scrypt$')) return limited(() => verifyScrypt(password, stored));
  return Promise.resolve(false);
}

/** ¿Hay que re-hashear tras un inicio de sesión correcto? (algoritmo anterior o parámetros distintos a los actuales). */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`$argon2id$v=19$m=${ARGON2.memoryCost},t=${ARGON2.timeCost},p=${ARGON2.parallelism}$`);
}

/**
 * Hash de referencia para igualar el tiempo de respuesta cuando el usuario no existe (mismo algoritmo y parámetros que
 * las cuentas actuales, así "no existe" y "contraseña incorrecta" tardan lo mismo).
 */
export const DUMMY_HASH = await argon2Hash(randomBytes(12).toString('hex'), ARGON2);
