import { and, eq } from 'drizzle-orm';
import { notificationSettingsUpdateSchema, pushRegisterSchema, pushUnregisterSchema, type NotificationSettings } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context';
import { notificationSettings, pushTokens } from '../db/schema';
import { parse } from '../errors';
import { sendTestNotification } from '../push';

const DEFAULT_SETTINGS: NotificationSettings = { enabled: false, loyaltyEnabled: true, billingEnabled: true, appointmentsEnabled: true, reviewsEnabled: true };

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
    return { enabled: row.enabled, loyaltyEnabled: row.loyaltyEnabled, billingEnabled: row.billingEnabled, appointmentsEnabled: row.appointmentsEnabled, reviewsEnabled: row.reviewsEnabled };
  });

  app.put('/notifications/settings', async (request): Promise<NotificationSettings> => {
    const businessId = businessOf(request);
    const input = parse(notificationSettingsUpdateSchema, request.body);
    await db
      .insert(notificationSettings)
      .values({ businessId, enabled: input.enabled, loyaltyEnabled: input.loyaltyEnabled, billingEnabled: input.billingEnabled, appointmentsEnabled: input.appointmentsEnabled, reviewsEnabled: input.reviewsEnabled })
      .onConflictDoUpdate({
        target: notificationSettings.businessId,
        set: { enabled: input.enabled, loyaltyEnabled: input.loyaltyEnabled, billingEnabled: input.billingEnabled, appointmentsEnabled: input.appointmentsEnabled, reviewsEnabled: input.reviewsEnabled, updatedAt: new Date() },
      });
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
}
