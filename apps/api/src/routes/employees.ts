import { and, desc, eq } from 'drizzle-orm';
import { employeeCreateSchema, employeeUpdateSchema, normalizePermissions, type AuditLogEntry, type Employee } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import type { Ctx } from '../context';
import { isUniqueViolation } from '../db/errors';
import { auditLogs, pushTokens, refreshTokens, users } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import { hashPassword } from '../security';
import { toEmployee } from '../serializers';

const auditQuery = z.object({ userId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

/**
 * Gestión de empleados (solo dueño — ver POLICY). Todo se acota a `request.user.bid` Y a `role = 'employee'`: un dueño
 * nunca ve ni toca usuarios de otro negocio, ni a sí mismo ni a otros dueños por esta vía. No hay borrado: se
 * desactiva (`active = false`), así la bitácora conserva quién hizo qué.
 */
export function employeeRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

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
    await findEmployee(businessId, id);

    const changes: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.permissions !== undefined) changes.permissions = normalizePermissions(input.permissions);
    if (input.active !== undefined) changes.active = input.active;
    if (input.password !== undefined) {
      changes.passwordHash = await hashPassword(input.password);
      changes.passwordChangedAt = new Date(); // invalida los access tokens ya emitidos
    }
    if (Object.keys(changes).length === 0) return toEmployee(await findEmployee(businessId, id));

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
    return toEmployee(updated);
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
