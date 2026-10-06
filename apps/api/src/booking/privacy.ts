import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { appointments, clients } from '../db/schema';

/**
 * Anonimiza los datos personales de un cliente (derecho de supresión, Ley 1581 / habeas data): borra su nombre real,
 * celular, correo, dirección, notas y foto, y limpia las notas y la IP que dejó en sus citas. Las citas en sí
 * (servicios, fechas, montos) se CONSERVAN: son registros contables que el negocio debe guardar por ley (Estatuto
 * Tributario), y la Ley 1581 no obliga a borrar lo que el responsable tiene el deber legal de conservar, solo a
 * quitar lo identificable. Devuelve `null` si el cliente no existe en ese negocio (nunca revela más que eso); si
 * existe, devuelve el archivo de foto que tenía (o null si no tenía) para que el llamador borre el archivo del disco.
 */
export async function anonymizeClient(db: DbExecutor, businessId: string, clientId: string): Promise<{ previousPhotoFile: string | null } | null> {
  const [existing] = await db.select({ photoFile: clients.photoFile }).from(clients).where(and(eq(clients.id, clientId), eq(clients.businessId, businessId))).limit(1);
  if (!existing) return null;
  await db
    .update(clients)
    .set({ name: 'Cliente eliminado', email: null, phone: null, address: '', notes: '', photoFile: null })
    .where(and(eq(clients.id, clientId), eq(clients.businessId, businessId)));
  await db.update(appointments).set({ customerNotes: '', termsAcceptedIp: null }).where(and(eq(appointments.clientId, clientId), eq(appointments.businessId, businessId)));
  return { previousPhotoFile: existing.photoFile };
}
