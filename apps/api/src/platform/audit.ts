import type { FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/client';
import { platformAuditLog } from '../db/schema';

export type PlatformOutcome = 'success' | 'denied' | 'error';

export interface PlatformAuditEntry {
  adminId: string | null;
  action: string;
  businessId?: string | null;
  outcome: PlatformOutcome;
  details?: Record<string, unknown>;
}

/** Claves que JAMÁS se guardan, aunque un llamador las pase por error (defensa en profundidad). */
const FORBIDDEN_KEY = /pass|token|secret|totp|code|authorization|cookie/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[omitido]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !FORBIDDEN_KEY.test(k)).map(([k, v]) => [k, scrub(v, depth + 1)]));
  }
  if (typeof value === 'string') return value.slice(0, 500);
  return value;
}

/**
 * Registra en la bitácora inmutable de la plataforma. A diferencia de la bitácora de empleados, aquí NO es de mejor
 * esfuerzo: si no se puede registrar, la operación falla (una acción administrativa sin rastro no debe ocurrir). Para las
 * acciones que cambian datos se llama DENTRO de la misma transacción: o quedan la acción y su registro, o ninguno.
 */
export async function recordPlatformAudit(db: DbExecutor, request: FastifyRequest, entry: PlatformAuditEntry): Promise<void> {
  await db.insert(platformAuditLog).values({
    adminId: entry.adminId,
    action: entry.action,
    businessId: entry.businessId ?? null,
    outcome: entry.outcome,
    requestId: request.id,
    ip: request.ip,
    details: scrub(entry.details ?? {}) as Record<string, unknown>,
  });
}
