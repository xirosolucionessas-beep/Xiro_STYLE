import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { businessUpdateSchema, cashOpeningSchema, changeMyPasswordSchema, deleteBusinessSchema, phoneChangeConfirmSchema, phoneChangeRequestSchema, profileUpdateSchema, type CashOpening, type Language } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { deleteOwnBusiness } from '../accountDeletion';
import type { Ctx } from '../context';
import { isUniqueViolation } from '../db/errors';
import { businesses, cashOpenings, phoneChanges, users } from '../db/schema';
import { AppError, parse } from '../errors';
import { removeMedia, saveAvatarImage, saveImage } from '../media';
import { hashPassword, verifyPassword } from '../passwords';
import { toBusiness, toUser } from '../serializers';
import { hmac, safeEqualHex, sixDigitCode } from '../security';

const PHONE_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_PHONE_OTP_ATTEMPTS = 5;

/** Fecha local (YYYY-MM-DD) en la zona horaria del negocio, para identificar "el día de hoy". */
function localDay(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Quita las claves `undefined` (campos no enviados) para que un PATCH parcial no toque el resto. */
function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

const toOpening = (row: typeof cashOpenings.$inferSelect): CashOpening => ({
  id: row.id,
  amount: row.amount,
  note: row.note,
  openedAt: row.openedAt.toISOString(),
});

export function accountRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

  async function currentContext(request: { user: { sub: string; bid: string } }) {
    const [user] = await db.select().from(users).where(eq(users.id, request.user.sub)).limit(1);
    const [business] = await db.select().from(businesses).where(eq(businesses.id, request.user.bid)).limit(1);
    if (!user || !business || user.businessId !== business.id) throw new AppError(401, 'unauthorized');
    return { user, business };
  }

  app.get('/me', async (request) => {
    const { user, business } = await currentContext(request);
    return { user: toUser(user), business: toBusiness(business) };
  });

  app.patch('/me', async (request) => {
    const { user } = await currentContext(request);
    const input = parse(profileUpdateSchema, request.body);
    const changes = defined({ name: input.name, language: input.language, theme: input.theme });
    if (Object.keys(changes).length === 0) return toUser(user);
    const [updated] = await db.update(users).set(changes).where(eq(users.id, user.id)).returning();
    return toUser(updated!);
  });

  /** Foto de la propia cuenta (dueño o empleado): mismo procesamiento que la de un profesional (cuadrada, 400×400, WebP). */
  app.put('/me/photo', async (request) => {
    const { user } = await currentContext(request);
    const part = await request.file();
    if (!part) throw new AppError(400, 'photo_invalid');
    const file = await saveAvatarImage(ctx.media, await part.toBuffer());
    if (!file) throw new AppError(400, 'photo_invalid');
    try {
      const [updated] = await db.update(users).set({ photoFile: file }).where(eq(users.id, user.id)).returning();
      await removeMedia(ctx.media, user.photoFile);
      return toUser(updated!);
    } catch (error) {
      await removeMedia(ctx.media, file);
      throw error;
    }
  });

  app.delete('/me/photo', async (request) => {
    const { user } = await currentContext(request);
    if (user.photoFile) {
      await db.update(users).set({ photoFile: null }).where(eq(users.id, user.id));
      await removeMedia(ctx.media, user.photoFile);
    }
    return toUser({ ...user, photoFile: null });
  });

  /**
   * Cambio de la propia contraseña (dueño o empleado) desde una sesión ya iniciada. No cierra otras sesiones ni la
   * propia (a diferencia de /auth/recover/reset, que ocurre SIN sesión y por eso sí las cierra todas): aquí la
   * persona ya demostró quién es con su contraseña ACTUAL, así que no hay nada sospechoso que mitigar.
   */
  app.post('/me/password', async (request) => {
    const { user } = await currentContext(request);
    const input = parse(changeMyPasswordSchema, request.body);
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) throw new AppError(400, 'invalid_current_password');
    if (await verifyPassword(input.newPassword, user.passwordHash)) throw new AppError(400, 'password_same_as_current');
    await db.update(users).set({ passwordHash: await hashPassword(input.newPassword) }).where(eq(users.id, user.id));
    return { ok: true };
  });

  /**
   * Cambio de celular en dos pasos: el número nuevo NO se guarda en `users` hasta confirmarlo con el código que
   * le llega a ESE número (mismo patrón que /auth/recover, pero atado a la sesión en vez de a un identificador).
   * Así, una sesión robada no puede desviar la recuperación de la cuenta a un teléfono ajeno sin controlarlo.
   */
  app.post('/me/phone/request', limit(5), async (request, reply) => {
    const { user } = await currentContext(request);
    const input = parse(phoneChangeRequestSchema, request.body);

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, input.phone)).limit(1);
    if (existing && existing.id !== user.id) throw new AppError(409, 'phone_taken');

    const code = sixDigitCode();
    await db.transaction(async (tx) => {
      await tx.delete(phoneChanges).where(eq(phoneChanges.userId, user.id));
      await tx.insert(phoneChanges).values({ userId: user.id, newPhone: input.phone, codeHash: hmac(config.jwtSecret, `phone:${user.id}:${code}`), expiresAt: new Date(Date.now() + PHONE_OTP_TTL_MS) });
    });
    await ctx.notifier.sendOtp({ channel: 'sms', to: input.phone, code, language: user.language as Language });
    return reply.status(202).send({ ok: true, ...(config.exposeDevOtp ? { devCode: code } : {}) });
  });

  app.post('/me/phone/confirm', limit(10), async (request) => {
    const { user } = await currentContext(request);
    const input = parse(phoneChangeConfirmSchema, request.body);
    const now = new Date();

    const [pending] = await db
      .select()
      .from(phoneChanges)
      .where(and(eq(phoneChanges.userId, user.id), eq(phoneChanges.used, false), gt(phoneChanges.expiresAt, now)))
      .orderBy(desc(phoneChanges.createdAt))
      .limit(1);
    if (!pending) throw new AppError(400, 'otp_invalid');

    // Cada intento se contabiliza en la base de datos y solo mientras queden intentos: igual que /auth/recover/verify.
    const [counted] = await db
      .update(phoneChanges)
      .set({ attempts: sql`${phoneChanges.attempts} + 1` })
      .where(and(eq(phoneChanges.id, pending.id), eq(phoneChanges.used, false), lt(phoneChanges.attempts, MAX_PHONE_OTP_ATTEMPTS)))
      .returning({ attempts: phoneChanges.attempts });
    if (!counted || !safeEqualHex(pending.codeHash, hmac(config.jwtSecret, `phone:${user.id}:${input.code}`))) throw new AppError(400, 'otp_invalid');

    const [redeemed] = await db.update(phoneChanges).set({ used: true }).where(and(eq(phoneChanges.id, pending.id), eq(phoneChanges.used, false))).returning({ id: phoneChanges.id });
    if (!redeemed) throw new AppError(400, 'otp_invalid');

    try {
      const [updated] = await db.update(users).set({ phone: pending.newPhone }).where(eq(users.id, user.id)).returning();
      return toUser(updated!);
    } catch (error) {
      if (isUniqueViolation(error, 'users_phone_uq')) throw new AppError(409, 'phone_taken');
      throw error;
    }
  });

  app.get('/business', async (request) => toBusiness((await currentContext(request)).business));

  app.patch('/business', async (request) => {
    const { business } = await currentContext(request);
    const input = parse(businessUpdateSchema, request.body);
    const changes = defined({
      name: input.name,
      type: input.type,
      whatsapp: input.whatsapp,
      address: input.address,
      city: input.city,
      country: input.country,
      taxId: input.taxId,
      currency: input.currency,
      hours: input.hours,
    });
    if (Object.keys(changes).length === 0) return toBusiness(business);
    const [updated] = await db.update(businesses).set(changes).where(eq(businesses.id, business.id)).returning();
    return toBusiness(updated!);
  });

  app.put('/business/logo', async (request) => {
    const { business } = await currentContext(request);
    const part = await request.file();
    if (!part) throw new AppError(400, 'photo_invalid');
    const file = await saveImage(ctx.media, await part.toBuffer());
    if (!file) throw new AppError(400, 'photo_invalid');
    const [updated] = await db.update(businesses).set({ logoFile: file }).where(eq(businesses.id, business.id)).returning();
    await removeMedia(ctx.media, business.logoFile);
    return toBusiness(updated!);
  });

  /**
   * Eliminación definitiva del negocio — solo el dueño (authz.ts), y esta ruta vuelve a comprobarlo: "oculto el botón"
   * nunca es el control de seguridad. Exige la contraseña ACTUAL del dueño (no basta con la sesión abierta) antes de
   * borrar nada. El borrado en sí (transaccional, con auditoría que sobrevive siempre) vive en accountDeletion.ts.
   */
  app.delete('/business', async (request, reply) => {
    const { user, business } = await currentContext(request);
    if (user.role !== 'owner') throw new AppError(403, 'forbidden');
    const input = parse(deleteBusinessSchema, request.body);
    if (!(await verifyPassword(input.password, user.passwordHash))) throw new AppError(400, 'invalid_current_password');
    await deleteOwnBusiness(ctx, request, business.id, { id: user.id, name: user.name, email: user.email, role: user.role }, business.name);
    return reply.status(200).send({ ok: true });
  });

  app.get('/cash/today', async (request) => {
    const { business } = await currentContext(request);
    const [today] = await db
      .select()
      .from(cashOpenings)
      .where(and(eq(cashOpenings.businessId, business.id), eq(cashOpenings.day, localDay(business.timezone))))
      .limit(1);
    return { opening: today ? toOpening(today) : null };
  });

  app.post('/cash/opening', async (request, reply) => {
    const { business } = await currentContext(request);
    const input = parse(cashOpeningSchema, request.body);
    // Un solo registro por negocio y día: el UPSERT es atómico aunque dos dispositivos abran caja a la vez.
    const [row] = await db
      .insert(cashOpenings)
      .values({ businessId: business.id, day: localDay(business.timezone), amount: input.amount, note: input.note })
      .onConflictDoUpdate({ target: [cashOpenings.businessId, cashOpenings.day], set: { amount: input.amount, note: input.note, openedAt: new Date() } })
      .returning();
    return reply.status(201).send({ opening: toOpening(row!) });
  });
}
