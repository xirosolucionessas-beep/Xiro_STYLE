import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { AppError, isUuid } from '../errors';

/** Transacción de Drizzle (todas las consultas del módulo de citas corren dentro de una). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * ÚNICA puerta de entrada a los datos de citas: abre una transacción, cambia al rol sin privilegios `xiro_app` y fija
 * el negocio activo (`app.business_id`). Desde ese momento PostgreSQL —con Row Level Security— rechaza leer o escribir
 * filas de cualquier otro negocio, aunque una consulta olvidara el filtro `business_id`.
 *
 * `businessId` SIEMPRE sale de la sesión autenticada (o del slug resuelto en el servidor), nunca del cuerpo, la
 * consulta ni la URL de la petición.
 */
export async function withBusiness<T>(db: Database, businessId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isUuid(businessId)) throw new AppError(500, 'internal_error', 'business scope without a valid id');
  return db.transaction(async (tx) => {
    // Rol y negocio en UNA sola ida a la base (Fase 5): set_config('role', …, true) es exactamente SET LOCAL ROLE (mismo
    // GUC, mismas comprobaciones de pertenencia, se revierte al terminar la transacción).
    await tx.execute(sql`select set_config('role', 'xiro_app', true), set_config('app.business_id', ${businessId.toLowerCase()}, true)`);
    return fn(tx);
  });
}

/**
 * Igual que `withBusiness` pero SIN cambiar al rol restringido: solo para el cierre de una cita, que además de las tablas
 * de citas escribe cobros, fidelización y existencias (tablas que `xiro_app` no puede modificar). Sigue exigiendo el negocio
 * de la sesión y todas sus consultas filtran por él; no se usa en ninguna ruta pública.
 */
export async function withBusinessTrusted<T>(db: Database, businessId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isUuid(businessId)) throw new AppError(500, 'internal_error', 'business scope without a valid id');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.business_id', ${businessId.toLowerCase()}, true)`);
    return fn(tx);
  });
}
