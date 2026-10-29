import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Criptografía del panel de plataforma, sin dependencias nuevas (solo node:crypto):
 *  - TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 dígitos), compatible con Google Authenticator, 1Password, Authy…
 *  - Cifrado AES-256-GCM del secreto TOTP en la base (la clave sale de PLATFORM_ADMIN_KEY y nunca se guarda).
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = B32.indexOf(char);
    if (index === -1) throw new Error('base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo de 160 bits (lo recomendado por la RFC 4226), en base32. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export const totpStep = (now: number = Date.now()): number => Math.floor(now / 1000 / STEP_SECONDS);

export function totpCode(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Devuelve el paso aceptado (para impedir reusar el mismo código) o null. Tolera ±1 paso (±30 s de desfase de reloj) y
 * rechaza cualquier paso <= `lastStep`: un código ya usado, aunque siga "vigente", no sirve dos veces.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number, now: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  let accepted: number | null = null;
  // Se recorren SIEMPRE los tres pasos (sin cortar al acertar): mismo tiempo de respuesta acierte o no.
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(totpCode(secretB32, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && step > lastStep && accepted === null) accepted = step;
  }
  return accepted;
}

export function otpauthUri(secretB32: string, email: string): string {
  const label = encodeURIComponent(`Xiro Style Admin:${email}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent('Xiro Style Admin')}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ---------- Cifrado del secreto ---------- */

const keyFrom = (adminKey: string): Buffer => createHash('sha256').update(`xiro-platform-totp:${adminKey}`).digest();

/** `v1.<iv>.<tag>.<cifrado>` en base64url. */
export function encryptSecret(adminKey: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(adminKey), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(adminKey: string, sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('secreto cifrado con formato desconocido');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(adminKey), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
