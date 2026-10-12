import { and, desc, eq } from 'drizzle-orm';
import { employeeCreateSchema, employeeUpdateSchema, normalizePermissions, type AuditLogEntry, type Employee } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import type { Ctx } from '../context';
import { isUniqueViolation } from '../db/errors';
import { auditLogs, pushTokens, refreshTokens, users } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import { removeMedia, saveAvatarImage } from '../media';
import { notifyUser } from '../push';
import { hashPassword } from '../security';
import { toEmployee } from '../serializers';

const auditQuery = z.object({ userId: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

/**
 * Gestión de empleados (solo dueño — ver POLICY). Todo se acota a `request.user.bid` Y a `role = 'employee'`: un dueño
 * nunca ve ni toca usuarios de otro negocio, ni a sí mismo ni a otros dueños por esta vía. No hay borrado: se
 * desactiva (`active = false`), así la bitácora conserva quién hizo qué.
 */
export function employeeRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;

  async function findEmployee(businessId: string, id: string) {
    const [row] = await db.select().from(users).where(and(eq(users.id, id), eq(users.businessId, businessId), eq(users.role, 'employee'))).limit(1);
    if (!row) throw notFound();
    return row;
  }
  const audit = (request: { user: { bid: string; sub: string }; log: { error: (e: unknown) => void } }, action: string, entityId: string, status: number) =>
    recordAudit(db, { businessId: request.user.bid, userId: request.user.sub, action, entityId, status }, (error) => request.log.error(error));

  app.get('/employees', async (request): Promise<Employee[]> => {
    const rows = await db.select().from(users).where(and(eq(users.businessId, request.user.bid), eq(users.role, 'employee'))).orderBy(users.name);
    return rows.map(toEmployee);
  });

  app.post('/employees', async (request, reply): Promise<unknown> => {
    const input = parse(employeeCreateSchema, request.body);
    const [owner] = await db.select({ language: users.language }).from(users).where(eq(users.id, request.user.sub)).limit(1);
    try {
      const [created] = await db
        .insert(users)
        .values({
          businessId: request.user.bid,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          passwordHash: await hashPassword(input.password),
          language: owner?.language ?? 'es',
          role: 'employee',
          permissions: normalizePermissions(input.permissions),
        })
        .returning();
      await audit(request, 'POST /employees', created!.id, 201);
      return reply.status(201).send(toEmployee(created!));
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_uq') || isUniqueViolation(error, 'users_phone_uq')) throw new AppError(409, 'account_exists');
      throw error;
    }
  });

  app.patch('/employees/:id', async (request): Promise<Employee> => {
    const businessId = request.user.bid;
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(employeeUpdateSchema, request.body);
    const before = await findEmployee(businessId, id);

    const changes: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.permissions !== undefined) changes.permissions = normalizePermissions(input.permissions);
    if (input.active !== undefined) changes.active = input.active;
    if (input.password !== undefined) {
      changes.passwordHash = await hashPassword(input.password);
      changes.passwordChangedAt = new Date(); // invalida los access tokens ya emitidos
    }
    if (Object.keys(changes).length === 0) return toEmployee(before);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(users).set(changes).where(and(eq(users.id, id), eq(users.businessId, businessId), eq(users.role, 'employee'))).returning();
      // Desactivar o cambiar la contraseña cierra todas sus sesiones y deja de mandarle avisos a ese dispositivo.
      if (input.active === false || input.password !== undefined) {
        await tx.delete(refreshTokens).where(eq(refreshTokens.userId, id));
        await tx.delete(pushTokens).where(eq(pushTokens.userId, id));
      }
      return row!;
    });
    await audit(request, 'PATCH /employees/:id', id, 200);
    // Avisos de mejor esfuerzo, fuera de la transacción. Desactivar NO avisa: sus tokens ya se borraron arriba y no
    // puede volver a iniciar sesión para verlo. El dedupeKey va atado al estado RESULTANTE (sección "no duplicar"):
    // un reintento con el mismo cambio no repite el aviso, pero un cambio distinto (u otra reactivación más tarde) sí.
    if (input.permissions !== undefined) {
      const key = normalizePermissions(input.permissions).slice().sort().join(',');
      void notifyUser(ctx, businessId, id, 'employees', { titleKey: 'push_employee_permissions_title', bodyKey: 'push_employee_permissions_body', dedupeKey: `employee_permissions:${id}:${key}`, href: '/profile' });
    }
    if (input.active === true && !before.active) {
      // `users` no tiene `updatedAt`: se usa el minuto actual como parte de la clave (reintentos de la misma petición
      // caen en el mismo minuto y se deduplican; una reactivación genuina más tarde cae en otro minuto y sí avisa).
      void notifyUser(ctx, businessId, id, 'employees', { titleKey: 'push_employee_reactivated_title', bodyKey: 'push_employee_reactivated_body', dedupeKey: `employee_active:${id}:${new Date().toISOString().slice(0, 16)}`, href: '/profile' });
    }
    return toEmployee(updated);
  });

  /**
   * Foto de cuenta de un empleado, puesta por el dueño (igual que `/me/photo`, que el propio empleado ya puede usar
   * para sí mismo): misma columna (`users.photoFile`), así que se ve en todos los mismos sitios sin importar quién
   * la subió.
   */
  app.put('/employees/:id/photo', async (request) => {
    const businessId = request.user.bid;
    const id = uuid((request.params as { id?: string }).id);
    const part = await request.file();
    if (!part) throw new AppError(400, 'photo_invalid');
    const file = await saveAvatarImage(ctx.media, await part.toBuffer());
    if (!file) throw new AppError(400, 'photo_invalid');
    try {
      const existing = await findEmployee(businessId, id);
      const [row] = await db.update(users).set({ photoFile: file }).where(and(eq(users.id, id), eq(users.businessId, businessId), eq(users.role, 'employee'))).returning();
      await removeMedia(ctx.media, existing.photoFile);
      return toEmployee(row!);
    } catch (error) {
      await removeMedia(ctx.media, file);
      throw error;
    }
  });

  app.delete('/employees/:id/photo', async (request) => {
    const businessId = request.user.bid;
    const id = uuid((request.params as { id?: string }).id);
    const existing = await findEmployee(businessId, id);
    const row = existing.photoFile ? (await db.update(users).set({ photoFile: null }).where(and(eq(users.id, id), eq(users.businessId, businessId), eq(users.role, 'employee'))).returning())[0] : existing;
    await removeMedia(ctx.media, existing.photoFile);
    return toEmployee(row!);
  });

  app.get('/audit-logs', async (request): Promise<AuditLogEntry[]> => {
    const query = parse(auditQuery, request.query);
    const rows = await db
      .select({ log: auditLogs, userName: users.name })
      .from(auditLogs)
      .innerJoin(users, eq(users.id, auditLogs.userId))
      .where(and(eq(auditLogs.businessId, request.user.bid), query.userId ? eq(auditLogs.userId, uuid(query.userId)) : undefined))
      .orderBy(desc(auditLogs.createdAt))
      .limit(query.limit);
    return rows.map(({ log, userName }) => ({ id: log.id, userId: log.userId, userName, action: log.action, entityId: log.entityId, status: log.status, createdAt: log.createdAt.toISOString() }));
  });
}
