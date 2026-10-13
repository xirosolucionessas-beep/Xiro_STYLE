import type { FastifyServerOptions } from 'fastify';

/**
 * Logs sin secretos. Fastify registra método + URL + cabeceras de cada petición; aquí se enmascara:
 *  - Cabeceras: Authorization, Cookie, Set-Cookie y X-Admin-Secret.
 *  - En la URL: el token de gestión de una cita (`/appointments/<token>`, `/gestion/<token>`: quien lo tiene puede
 *    cancelarla, reprogramarla o borrar los datos del cliente) y los parámetros de consulta con credenciales
 *    (`ticket` de la agenda en tiempo real, `token`, `code`, `secret`, `password`).
 * Los cuerpos (contraseñas, códigos OTP, refresh tokens) Fastify no los registra; aun así se cubren por si alguien
 * los loguea a mano (`request.log.info({ body })`).
 */
export const REDACTED = '[redactado]';

const SENSITIVE_QUERY = /([?&](?:ticket|token|code|secret|password|refreshToken|resetToken)=)[^&#]*/gi;
// Enlaces personales: gestión de cita, lista de espera y reseña (Fase 4), en la API y en la página pública.
const SENSITIVE_PATH = /(\/(?:appointments|gestion|waitlist|espera|review-link|resena)\/)[^/?#]+/gi;

export function redactUrl(url: string): string {
  return url.replace(SENSITIVE_PATH, `$1${REDACTED}`).replace(SENSITIVE_QUERY, `$1${REDACTED}`);
}

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-secret"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.code',
  '*.otp',
  '*.token',
  '*.refreshToken',
  '*.resetToken',
  '*.accessToken',
];

interface SerializedRequest {
  [key: string]: unknown;
  method: string;
  url: string;
  host?: string;
  remoteAddress?: string;
  remotePort?: number;
}

export function loggerOptions(level: string): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    serializers: {
      req(request: { method: string; url: string; hostname?: string; ip?: string; socket?: { remotePort?: number } }): SerializedRequest {
        return { method: request.method, url: redactUrl(request.url), host: request.hostname, remoteAddress: request.ip, remotePort: request.socket?.remotePort };
      },
    },
  };
}
