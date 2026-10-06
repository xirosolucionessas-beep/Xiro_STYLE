import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from './db/client';
import { loyaltyProgramItems, loyaltyPrograms, loyaltyProgress, serviceRecords } from './db/schema';

export interface RecordServiceInput {
  businessId: string;
  clientId: string;
  /** Artículo del catálogo; null (p. ej. un paquete) = cobro sin sello de fidelización. */
  itemId: string | null;
  label: string;
  amount: number;
  /** De qué tipo era lo cobrado (Tarea 5): separa el valor de servicios del de productos en Inicio/Reportes. */
  kind: 'service' | 'product';
  note: string;
  createdBy: string;
  appointmentId?: string | null;
}

/**
 * Registra un servicio (o producto) cobrado a un cliente y, si el artículo participa en el programa de fidelización,
 * suma exactamente un sello. Es la ÚNICA puerta por la que se cobra: la usan el registro manual y el cierre de una cita,
 * así Reportes, Inicio y Fidelización ven siempre lo mismo. Debe llamarse dentro de una transacción.
 */
export async function recordService(tx: DbExecutor, input: RecordServiceInput): Promise<{ record: typeof serviceRecords.$inferSelect; rewardJustEarned: boolean }> {
  const { businessId } = input;
  const [program] = await tx.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.businessId, businessId)).limit(1);
  let eligible = false;
  if (program?.enabled && input.itemId) {
    const [link] = await tx
      .select()
      .from(loyaltyProgramItems)
      .where(and(eq(loyaltyProgramItems.programId, program.id), eq(loyaltyProgramItems.itemId, input.itemId)))
      .limit(1);
    eligible = Boolean(link);
  }

  const [record] = await tx
    .insert(serviceRecords)
    .values({
      businessId,
      clientId: input.clientId,
      itemId: input.itemId,
      label: input.label,
      amount: input.amount,
      kind: input.kind,
      note: input.note,
      loyaltyCounted: eligible,
      appointmentId: input.appointmentId ?? null,
      createdBy: input.createdBy,
    })
    .returning();

  let rewardJustEarned = false;
  if (eligible) {
    const [updated] = await tx
      .insert(loyaltyProgress)
      .values({ businessId, clientId: input.clientId, count: 1 })
      .onConflictDoUpdate({ target: [loyaltyProgress.businessId, loyaltyProgress.clientId], set: { count: sql`${loyaltyProgress.count} + 1`, updatedAt: new Date() } })
      .returning();
    rewardJustEarned = updated!.count >= program!.goal;
  }
  return { record: record!, rewardJustEarned };
}
