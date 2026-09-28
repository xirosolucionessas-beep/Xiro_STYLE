import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { appointments, clients } from '../db/schema';

/**
 * Anonimiza los datos personales de un cliente (derecho de supresión, Ley 1581 / habeas data): borra su nombre real,
 * celular, correo, dirección y notas, y limpia las notas y la IP que dejó en sus citas. Las citas en sí (servicios,
 * fechas, montos) se CONSERVAN: son registros contables que el negocio debe guardar por ley (Estatuto Tributario), y
 * la Ley 1581 no obliga a borrar lo que el responsable tiene el deber legal de conservar, solo a quitar lo identificable.
 * Devuelve `false` si el cliente no existe en ese negocio (nunca revela más que eso).
 */
export async function anonymizeClient(db: DbExecutor, businessId: string, clientId: string): Promise<boolean> {
  const [updated] = await db
    .update(clients)
    .set({ name: 'Cliente eliminado', email: null, phone: null, address: '', notes: '' })
    .where(and(eq(clients.id, clientId), eq(clients.businessId, businessId)))
    .returning({ id: clients.id });
  if (!updated) return false;
  await db.update(appointments).set({ customerNotes: '', termsAcceptedIp: null }).where(and(eq(appointments.clientId, clientId), eq(appointments.businessId, businessId)));
  return true;
}
