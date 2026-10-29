import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Ctx } from './context';
import { businessAccessGrants, businessPublicProfiles, businesses, clientAccounts, clients, itemPhotos, items, servicePackages, serviceVariants, users } from './db/schema';
import type { DbExecutor } from './db/client';
import { AppError, notFound } from './errors';
import { removeMedia } from './media';
import { recordPlatformAudit } from './platform/audit';
import { BUSINESS_SELF_DELETE_ACTION } from './platform/businesses';

/** Número oficial de XIRO (ver la propuesta de este encargo) — nunca el de un negocio, nunca un secreto. */
export const XIRO_WHATSAPP_NUMBER = '573013059562';

export interface DeletionActor {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

/**
 * Nombres de archivo de TODAS las fotos del negocio (logo, portada/galería de la página pública, fotos de personas,
 * fotos de clientes y de sus cuentas, fotos de productos y de variantes/paquetes). Se recogen ANTES de borrar — una
 * vez borradas las filas, sus nombres desaparecen con ellas — para limpiarlas del almacén DESPUÉS de confirmar la
 * transacción (igual criterio que `removeMedia` en el resto de la API: nunca se borra un archivo antes de que el
 * cambio en la base quede en firme).
 */
async function collectBusinessMediaFiles(tx: DbExecutor, businessId: string): Promise<string[]> {
  const files: Array<string | null | undefined> = [];

  const [business] = await tx.select({ logoFile: businesses.logoFile }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  files.push(business?.logoFile);

  const [profile] = await tx.select({ coverFile: businessPublicProfiles.coverFile, galleryFiles: businessPublicProfiles.galleryFiles }).from(businessPublicProfiles).where(eq(businessPublicProfiles.businessId, businessId)).limit(1);
  files.push(profile?.coverFile, ...(profile?.galleryFiles ?? []));

  const userRows = await tx.select({ photoFile: users.photoFile }).from(users).where(eq(users.businessId, businessId));
  files.push(...userRows.map((r) => r.photoFile));

  const clientRows = await tx.select({ photoFile: clients.photoFile }).from(clients).where(eq(clients.businessId, businessId));
  files.push(...clientRows.map((r) => r.photoFile));

  const clientAccountRows = await tx.select({ photoFile: clientAccounts.photoFile }).from(clientAccounts).where(eq(clientAccounts.businessId, businessId));
  files.push(...clientAccountRows.map((r) => r.photoFile));

  const itemPhotoRows = await tx.select({ file: itemPhotos.file }).from(itemPhotos).innerJoin(items, eq(items.id, itemPhotos.itemId)).where(eq(items.businessId, businessId));
  files.push(...itemPhotoRows.map((r) => r.file));

  const variantRows = await tx.select({ photoFile: serviceVariants.photoFile }).from(serviceVariants).where(eq(serviceVariants.businessId, businessId));
  files.push(...variantRows.map((r) => r.photoFile));

  const packageRows = await tx.select({ photoFile: servicePackages.photoFile }).from(servicePackages).where(eq(servicePackages.businessId, businessId));
  files.push(...packageRows.map((r) => r.photoFile));

  return files.filter((file): file is string => Boolean(file));
}

function auditDetails(actor: DeletionActor, businessName: string, extra: Record<string, unknown> = {}) {
  return { businessName, requestedByUserId: actor.id, requestedByName: actor.name, requestedByEmail: actor.email, requestedByRole: actor.role, ...extra };
}

/**
 * Eliminación definitiva del negocio del propio dueño — ver la propuesta de este encargo. Autoriza DOS VECES antes de
 * llegar aquí (authz.ts exige 'owner'; la ruta vuelve a comprobar el rol y la contraseña), así que esta función
 * asume que ya se verificó todo eso: aquí solo vive el borrado transaccional y su auditoría.
 *
 * TODO lo del negocio cae en cascada desde `businesses` (ver schema.ts) salvo una excepción: las concesiones de
 * acceso administrativas (`business_access_grants`) tienen `onDelete: 'restrict'` a propósito (no son dato del
 * negocio, son un registro de la administración de la plataforma) — se borran aquí explícitamente, en la misma
 * transacción, antes de borrar el negocio.
 *
 * El registro de auditoría (`platform_audit_log`) SIEMPRE sobrevive, incluso si la eliminación falla: se escribe
 * DENTRO de la transacción cuando sale bien (o ninguno de los dos queda) y en una escritura aparte, fuera de ella,
 * cuando falla (la transacción ya se revirtió, así que ese intento solo puede registrarse por separado). Nunca se
 * anuncia éxito si la transacción no se confirmó.
 */
export async function deleteOwnBusiness(ctx: Ctx, request: FastifyRequest, businessId: string, actor: DeletionActor, businessName: string): Promise<void> {
  let mediaFiles: string[];
  try {
    mediaFiles = await ctx.db.transaction(async (tx) => {
      const files = await collectBusinessMediaFiles(tx, businessId);
      await tx.delete(businessAccessGrants).where(eq(businessAccessGrants.businessId, businessId));
      const deleted = await tx.delete(businesses).where(eq(businesses.id, businessId)).returning({ id: businesses.id });
      if (deleted.length === 0) throw notFound();
      await recordPlatformAudit(tx, request, { adminId: null, action: BUSINESS_SELF_DELETE_ACTION, businessId, outcome: 'success', details: auditDetails(actor, businessName) });
      return files;
    });
  } catch (error) {
    await recordPlatformAudit(ctx.db, request, {
      adminId: null,
      action: BUSINESS_SELF_DELETE_ACTION,
      businessId,
      outcome: 'error',
      details: auditDetails(actor, businessName, { error: error instanceof AppError ? error.code : 'unknown_error' }),
    }).catch((auditError) => request.log.error({ err: auditError }, 'No se pudo registrar el intento fallido de eliminación de negocio'));
    throw error;
  }

  // Limpieza de archivos: best-effort y DESPUÉS de confirmar — `removeMedia` ya traga sus propios errores.
  await Promise.all(mediaFiles.map((file) => removeMedia(ctx.media, file)));

  await ctx.notifier
    .sendAdminAlert?.({ to: XIRO_WHATSAPP_NUMBER, event: 'business_self_deleted', businessName, businessId, requestedByName: actor.name, at: new Date().toISOString() })
    .catch((error) => request.log.error({ err: error }, 'No se pudo avisar a XIRO de la eliminación del negocio'));
}
