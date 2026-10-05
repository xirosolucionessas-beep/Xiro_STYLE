import { REORDER_THRESHOLD } from '@xiro/shared';
import { and, eq, sql } from 'drizzle-orm';
import { appointmentItems, items } from '../db/schema';
import { recordService } from '../serviceRecording';
import type { AppointmentRow } from './appointments';
import type { Tx } from './scope';

export interface CompletionEffects {
  /** Cobros registrados (uno por servicio, paquete o producto de la cita). */
  records: number;
  /** El cliente acaba de completar su meta de fidelización con esta cita. */
  rewardJustEarned: boolean;
  /** Productos cuyo stock quedó en 'reorder'/'out_of_stock' tras descontar esta cita (para avisar FUERA de la transacción). */
  stockMoved: Array<{ id: string; name: string; stockStatus: string }>;
}

/**
 * Al completar una cita se cierra el ciclo con el resto del negocio, en la MISMA transacción que el cambio de estado
 * (o todo queda hecho o nada):
 *  - cada servicio, paquete y producto se cobra como un registro de servicio → alimenta Reportes, Inicio y Caja;
 *  - los servicios elegibles suman su sello de fidelización;
 *  - los productos descuentan existencias (sin bajar de cero: lo vendido ya se vendió) y actualizan su estado de stock.
 * Los precios son los CONGELADOS al reservar, no los de hoy.
 */
export async function applyCompletion(tx: Tx, businessId: string, appointment: AppointmentRow, userId: string): Promise<CompletionEffects> {
  const lines = await tx.select().from(appointmentItems).where(and(eq(appointmentItems.businessId, businessId), eq(appointmentItems.appointmentId, appointment.id)));
  let records = 0;
  let rewardJustEarned = false;
  const stockMoved: CompletionEffects['stockMoved'] = [];
  for (const line of lines) {
    if (line.kind === 'product' && line.itemId) {
      const next = sql`greatest(${items.stock} - ${line.quantity}, 0)`;
      const [updated] = await tx
        .update(items)
        .set({ stock: next, stockStatus: sql`case when ${next} <= 0 then 'out_of_stock' when ${next} <= ${REORDER_THRESHOLD} then 'reorder' else 'available' end`, updatedAt: new Date() })
        .where(and(eq(items.id, line.itemId), eq(items.businessId, businessId)))
        .returning({ id: items.id, name: items.name, stockStatus: items.stockStatus });
      if (updated) stockMoved.push(updated);
    }
    const result = await recordService(tx, {
      businessId,
      clientId: appointment.clientId,
      itemId: line.kind === 'package' ? null : line.itemId,
      label: line.quantity > 1 ? `${line.name} ×${line.quantity}` : line.name,
      amount: line.price * line.quantity,
      // Un paquete agrupa servicios: cuenta como servicio para separar el valor de servicios del de productos.
      kind: line.kind === 'package' ? 'service' : (line.kind as 'service' | 'product'),
      note: '',
      createdBy: userId,
      appointmentId: appointment.id,
    });
    records += 1;
    rewardJustEarned ||= result.rewardJustEarned;
  }
  return { records, rewardJustEarned, stockMoved };
}
