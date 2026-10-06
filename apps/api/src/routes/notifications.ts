import { and, desc, eq } from 'drizzle-orm';
import { notificationSettingsUpdateSchema, notificationsQuerySchema, pushRegisterSchema, pushUnregisterSchema, type NotificationDto, type NotificationSettings } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context';
import { notifications, notificationSettings, pushTokens } from '../db/schema';
import { notFound, parse, uuid } from '../errors';
import { sendTestNotification } from '../push';

const toNotificationDto = (row: typeof notifications.$inferSelect): NotificationDto => ({
  id: row.id,
  category: row.category as NotificationDto['category'],
  titleKey: row.titleKey,
  bodyKey: row.bodyKey,
  params: row.params,
  href: row.href,
  read: row.read,
  createdAt: row.createdAt.toISOString(),
});

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  loyaltyEnabled: true,
  billingEnabled: true,
  appointmentsEnabled: true,
  reviewsEnabled: true,
  clientsEnabled: true,
  salesEnabled: true,
  inventoryEnabled: true,
  employeesEnabled: true,
  securityEnabled: true,
};

/**
 * Notificaciones push: preferencias por negocio (interruptor general + por categoría), registro de tokens por
 * dispositivo (Expo para Android/iOS, suscripción Web Push para el navegador) y envío de prueba. El envío real de
 * eventos del negocio (premio de fidelización, problemas de facturación) vive en push.ts y lo llaman otras rutas.
 */
export function notificationRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const businessOf = (request: { user: { bid: string; sub: string } }) => request.user.bid;

  app.get('/notifications/settings', async (request): Promise<NotificationSettings> => {
    const [row] = await db.select().from(notificationSettings).where(eq(notificationSettings.businessId, businessOf(request))).limit(1);
    if (!row) return DEFAULT_SETTINGS;
    return {
      enabled: row.enabled,
      loyaltyEnabled: row.loyaltyEnabled,
      billingEnabled: row.billingEnabled,
      appointmentsEnabled: row.appointmentsEnabled,
      reviewsEnabled: row.reviewsEnabled,
      clientsEnabled: row.clientsEnabled,
      salesEnabled: row.salesEnabled,
      inventoryEnabled: row.inventoryEnabled,
      employeesEnabled: row.employeesEnabled,
      securityEnabled: row.securityEnabled,
    };
  });

  app.put('/notifications/settings', async (request): Promise<NotificationSettings> => {
    const businessId = businessOf(request);
    const input = parse(notificationSettingsUpdateSchema, request.body);
    const values = { businessId, ...input };
    await db
      .insert(notificationSettings)
      .values(values)
      .onConflictDoUpdate({ target: notificationSettings.businessId, set: { ...input, updatedAt: new Date() } });
    return input;
  });

  // Sin esto configurado, el botón de activar en la Web debe avisar honestamente en vez de fingir que funciona.
  app.get('/notifications/vapid-public-key', async (): Promise<{ publicKey: string | null }> => ({ publicKey: config.notifications.vapidPublicKey }));

  app.post('/notifications/register', async (request): Promise<{ ok: true }> => {
    const businessId = businessOf(request);
    const userId = request.user.sub;
    const input = parse(pushRegisterSchema, request.body);
    const token = input.platform === 'expo' ? input.token : input.endpoint;
    await db
      .insert(pushTokens)
      .values({
        businessId,
        userId,
        platform: input.platform,
        token,
        p256dh: input.platform === 'web' ? input.keys.p256dh : null,
        auth: input.platform === 'web' ? input.keys.auth : null,
      })
      .onConflictDoUpdate({ target: [pushTokens.userId, pushTokens.token], set: { p256dh: input.platform === 'web' ? input.keys.p256dh : null, auth: input.platform === 'web' ? input.keys.auth : null } });
    return { ok: true };
  });

  app.delete('/notifications/register', async (request): Promise<{ ok: true }> => {
    const input = parse(pushUnregisterSchema, request.body);
    await db.delete(pushTokens).where(and(eq(pushTokens.userId, request.user.sub), eq(pushTokens.token, input.token)));
    return { ok: true };
  });

  app.post('/notifications/test', async (request): Promise<{ sent: number; pruned: number }> => sendTestNotification(ctx, businessOf(request), request.user.sub));

  /* ---------- Centro de notificaciones (historial en la app) ---------- */

  /** Solo LAS PROPIAS: cada quien ve sus notificaciones (las de un dueño nunca las ve un empleado, y viceversa). */
  app.get('/notifications', async (request): Promise<{ notifications: NotificationDto[]; unread: number }> => {
    const { limit } = parse(notificationsQuerySchema, request.query);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, request.user.sub)).orderBy(desc(notifications.createdAt)).limit(limit);
    const unread = rows.filter((row) => !row.read).length;
    return { notifications: rows.map(toNotificationDto), unread };
  });

  app.post('/notifications/:id/read', async (request): Promise<NotificationDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const [row] = await db.update(notifications).set({ read: true }).where(and(eq(notifications.id, id), eq(notifications.userId, request.user.sub))).returning();
    if (!row) throw notFound();
    return toNotificationDto(row);
  });

  app.post('/notifications/read-all', async (request): Promise<{ ok: true }> => {
    await db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, request.user.sub), eq(notifications.read, false)));
    return { ok: true };
  });
}
