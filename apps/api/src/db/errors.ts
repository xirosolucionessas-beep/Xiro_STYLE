/** Códigos SQLSTATE de PostgreSQL relevantes. drizzle envuelve el error de `pg` en `cause`. */
const PG_CODE = /^[0-9A-Z]{5}$/;

function pgError(error: unknown): { code?: string; constraint?: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && PG_CODE.test(candidate.code)) {
      return { code: candidate.code, constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined };
    }
    current = candidate.cause;
  }
  return undefined;
}

export const pgCode = (error: unknown) => pgError(error)?.code;

/** 23505: violación de UNIQUE (opcionalmente de una restricción concreta). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const info = pgError(error);
  return info?.code === '23505' && (!constraint || info.constraint === constraint);
}

/** 23503: violación de FOREIGN KEY. */
export const isForeignKeyViolation = (error: unknown) => pgCode(error) === '23503';

/** 23P01: violación de una restricción de EXCLUSIÓN (dos citas activas del mismo profesional que se cruzan). */
export const isExclusionViolation = (error: unknown) => pgCode(error) === '23P01';

/** 23514: violación de CHECK. */
export const isCheckViolation = (error: unknown) => pgCode(error) === '23514';

/** Fallos transitorios que conviene reintentar: serialization_failure y deadlock_detected. */
export const isRetryable = (error: unknown) => ['40001', '40P01'].includes(pgCode(error) ?? '');

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN']);
const UNAVAILABLE_MESSAGE = /timeout exceeded when trying to connect|Connection terminated|Cannot use a pool after calling end|the database system is (starting up|shutting down)/i;

/**
 * La base de datos no está disponible o está saturada (no es un fallo de la petición): consulta cortada por statement_timeout (57014),
 * servidor apagándose (57P01-57P03), demasiadas conexiones (53300), errores de conexión (clase 08) y de red, o pool agotado/cerrado.
 * El cliente puede reintentar.
 */
export function isUnavailable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof candidate.code === 'string') {
      const code = candidate.code;
      if (NETWORK_CODES.has(code) || ['57014', '57P01', '57P02', '57P03', '53300'].includes(code) || (PG_CODE.test(code) && code.startsWith('08'))) return true;
    }
    if (typeof candidate.message === 'string' && UNAVAILABLE_MESSAGE.test(candidate.message)) return true;
    if (Array.isArray(candidate.errors) && candidate.errors.some(isUnavailable)) return true; // AggregateError (varias direcciones)
    current = candidate.cause;
  }
  return false;
}
