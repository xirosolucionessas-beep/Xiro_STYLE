import type { Database } from './db/client';
import { auditLogs } from './db/schema';

interface AuditEntry {
  businessId: string;
  userId: string;
  action: string;
  entityId?: string | null;
  status: number;
}

/** Mejor esfuerzo: registrar la bitácora nunca debe tumbar ni revertir la acción que se está auditando. */
export async function recordAudit(db: Database, entry: AuditEntry, onError: (error: unknown) => void = () => undefined): Promise<void> {
  try {
    await db.insert(auditLogs).values({ businessId: entry.businessId, userId: entry.userId, action: entry.action, entityId: entry.entityId ?? null, status: entry.status });
  } catch (error) {
    onError(error);
  }
}
