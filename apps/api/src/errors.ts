import type { ApiErrorBody } from '@xiro/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import { isUnavailable } from './db/errors';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly headers?: Record<string, string>,
    /** Campos extra del cuerpo de la respuesta (p. ej. horarios alternativos en `slot_taken`). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const notFound = () => new AppError(404, 'not_found');

/** Parses with a shared schema; validation failures become a 400 via the error handler. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Un id con formato inválido nunca puede existir: responde 404 (igual que un id desconocido), sin llegar a la base de datos. */
export function uuid(value: unknown): string {
  if (isUuid(value)) return value.toLowerCase();
  throw notFound();
}

/** PostgreSQL no admite el carácter NUL en texto: se rechaza en la frontera en vez de producir un error 500. */
export function containsNul(value: unknown, depth = 0): boolean {
  if (depth > 12) return true; // JSON absurdamente anidado
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some((item) => containsNul(item, depth + 1));
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => key.includes('\u0000') || containsNul(item, depth + 1));
  return false;
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof ZodError) {
      const body: ApiErrorBody = {
        code: 'validation_error',
        message: 'Invalid request',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      };
      return reply.status(400).send(body);
    }
    if (error instanceof AppError) {
      const body = { code: error.code, message: error.message, ...error.extra } as ApiErrorBody;
      if (error.headers) reply.headers(error.headers);
      return reply.status(error.status).send(body);
    }
    const fastifyError = error as FastifyError;
    if (fastifyError.statusCode === 429) {
      return reply.status(429).send({ code: 'too_many_requests', message: 'Too many requests' } satisfies ApiErrorBody);
    }
    if (fastifyError.statusCode === 413 || fastifyError.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ code: 'photo_invalid', message: 'File too large' } satisfies ApiErrorBody);
    }
    if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send({ code: 'bad_request', message: fastifyError.message } satisfies ApiErrorBody);
    }
    // Base de datos caída, saturada o consulta cortada por statement_timeout: el cliente puede reintentar.
    if (isUnavailable(error)) {
      request.log.error(error);
      return reply.status(503).header('Retry-After', '2').send({ code: 'service_unavailable', message: 'Service temporarily unavailable' } satisfies ApiErrorBody);
    }
    request.log.error(error);
    return reply.status(500).send({ code: 'internal_error', message: 'Internal server error' } satisfies ApiErrorBody);
  });
}
