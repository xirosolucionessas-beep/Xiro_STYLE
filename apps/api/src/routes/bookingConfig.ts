import {
  bookingSettingsInputSchema,
  can,
  closureInputSchema,
  employeeScheduleInputSchema,
  professionalInputSchema,
  professionalServicesInputSchema,
  publicProfileInputSchema,
  slugSchema,
  timeOffInputSchema,
  type BookingAdminSettings,
  type ClosureDto,
  type ProfessionalDto,
  pageQuerySchema,
  type Page,
  type ReviewDto,
  type TimeOffDto,
} from '@xiro/shared';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadContext } from '../booking/availability';
import { withBusiness, type Tx } from '../booking/scope';
import { allSections, loadProfessionals, loadProfileRow, loadReadiness, toReviewDto } from '../booking/view';
import type { Ctx } from '../context';
import { isUniqueViolation } from '../db/errors';
import { businessClosures, businessPublicProfiles, businessSettings, businessSlugHistory, businesses, employeeProfiles, employeeSchedules, employeeServices, employeeTimeOff, items, reviews, users } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import { mediaUrl, removeMedia, saveAvatarImage, saveImage } from '../media';
import { decodeCursor, descNullsLast, toPage } from '../pagination';

const MAX_GALLERY = 8;
/** Subir o quitar la foto de una persona del equipo, por negocio y por minuto: de sobra para un uso normal, corta un abuso. */
const PHOTO_WRITES_PER_MINUTE = 20;
const slugCheckQuery = z.object({ slug: z.string().trim().toLowerCase().max(60) });
const reviewsQuery = pageQuerySchema.extend({ status: z.enum(['pending', 'approved', 'hidden']).optional() });
const reviewPatch = z.object({ status: z.enum(['approved', 'hidden']) });

/**
 * Configuración de la agenda y de la página pública de reservas (todo autenticado y acotado al negocio de la sesión).
 * Toda consulta de las tablas de citas pasa por `withBusiness` (Row Level Security como segunda barrera).
 */
export function bookingConfigRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const scoped = <T>(request: { user: { bid: string } }, fn: (tx: Tx) => Promise<T>) => withBusiness(db, request.user.bid, fn);
  const photoLimiter = ctx.rates.limiter('photo-writes', 60_000);
  async function checkPhotoLimit(request: { user: { bid: string } }): Promise<void> {
    if (config.rateLimit.enabled && (await photoLimiter.hit(request.user.bid)) > PHOTO_WRITES_PER_MINUTE) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await photoLimiter.retryAfterSeconds(request.user.bid)) });
    }
  }

  /* ---------- Reglas y perfil ---------- */

  async function adminSettings(tx: Tx, businessId: string): Promise<BookingAdminSettings> {
    const context = await loadContext(tx, businessId);
    const profile = await loadProfileRow(tx, businessId);
    return {
      settings: context.settings,
      slug: context.business.slug,
      timezone: context.business.timezone,
      readiness: await loadReadiness(tx, context, profile?.published ?? false),
      profile: {
        published: profile?.published ?? false,
        displayName: profile?.displayName ?? '',
        tagline: profile?.tagline ?? '',
        description: profile?.description ?? '',
        conditions: profile?.conditions ?? '',
        privacyPolicy: profile?.privacyPolicy ?? '',
        phone: profile?.phone ?? '',
        instagram: profile?.instagram ?? '',
        facebook: profile?.facebook ?? '',
        tiktok: profile?.tiktok ?? '',
        website: profile?.website ?? '',
        latitude: profile?.latitude ?? null,
        longitude: profile?.longitude ?? null,
        mapAddress: profile?.mapAddress ?? '',
        placeId: profile?.placeId ?? null,
        coverUrl: profile?.coverFile ? mediaUrl(profile.coverFile) : null,
        gallery: (profile?.galleryFiles ?? []).map((file) => ({ file, url: mediaUrl(file) })),
        sections: allSections(profile?.sections),
      },
    };
  }

  app.get('/booking/settings', async (request): Promise<BookingAdminSettings> => scoped(request, (tx) => adminSettings(tx, request.user.bid)));

  app.put('/booking/settings', async (request): Promise<BookingAdminSettings> => {
    const input = parse(bookingSettingsInputSchema, request.body);
    return scoped(request, async (tx) => {
      const values = { ...input, updatedAt: new Date() };
      await tx.insert(businessSettings).values({ businessId: request.user.bid, ...values }).onConflictDoUpdate({ target: businessSettings.businessId, set: values });
      return adminSettings(tx, request.user.bid);
    });
  });

  app.put('/booking/profile', async (request): Promise<BookingAdminSettings> => {
    const input = parse(publicProfileInputSchema, request.body);
    return scoped(request, async (tx) => {
      const existing = await loadProfileRow(tx, request.user.bid);
      const { sections, ...rest } = input;
      const changes = {
        ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
        ...(sections ? { sections: { ...(existing?.sections ?? {}), ...sections } } : {}),
        updatedAt: new Date(),
      };
      // Coordenadas: siempre juntas (lo exige también la base de datos).
      if (('latitude' in changes) !== ('longitude' in changes)) throw new AppError(400, 'validation_error');
      // La dirección y el lugar de Google solo describen el pin: al quitar la ubicación no deben quedar huérfanos (y menos a la
      // vista en la página pública).
      if ('latitude' in changes && (changes as { latitude: number | null }).latitude === null) Object.assign(changes, { mapAddress: '', placeId: null });
      await tx.insert(businessPublicProfiles).values({ businessId: request.user.bid, ...changes }).onConflictDoUpdate({ target: businessPublicProfiles.businessId, set: changes });
      return adminSettings(tx, request.user.bid);
    });
  });

  app.put('/booking/profile/cover', async (request): Promise<BookingAdminSettings> => {
    const part = await request.file();
    if (!part) throw new AppError(400, 'photo_invalid');
    const file = await saveImage(ctx.media, await part.toBuffer());
    if (!file) throw new AppError(400, 'photo_invalid');
    try {
      const previous = await scoped(request, async (tx) => {
        const existing = await loadProfileRow(tx, request.user.bid);
        await tx.insert(businessPublicProfiles).values({ businessId: request.user.bid, coverFile: file }).onConflictDoUpdate({ target: businessPublicProfiles.businessId, set: { coverFile: file, updatedAt: new Date() } });
        return existing?.coverFile ?? null;
      });
      await removeMedia(ctx.media, previous);
    } catch (error) {
      await removeMedia(ctx.media, file);
      throw error;
    }
    return scoped(request, (tx) => adminSettings(tx, request.user.bid));
  });

  app.delete('/booking/profile/cover', async (request): Promise<BookingAdminSettings> => {
    const previous = await scoped(request, async (tx) => {
      const existing = await loadProfileRow(tx, request.user.bid);
      if (existing) await tx.update(businessPublicProfiles).set({ coverFile: null, updatedAt: new Date() }).where(eq(businessPublicProfiles.businessId, request.user.bid));
      return existing?.coverFile ?? null;
    });
    await removeMedia(ctx.media, previous);
    return scoped(request, (tx) => adminSettings(tx, request.user.bid));
  });

  app.post('/booking/profile/gallery', async (request, reply) => {
    const part = await request.file();
    if (!part) throw new AppError(400, 'photo_invalid');
    const file = await saveImage(ctx.media, await part.toBuffer());
    if (!file) throw new AppError(400, 'photo_invalid');
    try {
      await scoped(request, async (tx) => {
        const [locked] = await tx.select().from(businessPublicProfiles).where(eq(businessPublicProfiles.businessId, request.user.bid)).for('update');
        const files = locked?.galleryFiles ?? [];
        if (files.length >= MAX_GALLERY) throw new AppError(400, 'photo_limit');
        await tx.insert(businessPublicProfiles).values({ businessId: request.user.bid, galleryFiles: [...files, file] }).onConflictDoUpdate({ target: businessPublicProfiles.businessId, set: { galleryFiles: [...files, file], updatedAt: new Date() } });
      });
    } catch (error) {
      await removeMedia(ctx.media, file);
      throw error;
    }
    return reply.status(201).send(await scoped(request, (tx) => adminSettings(tx, request.user.bid)));
  });

  app.delete('/booking/profile/gallery/:file', async (request): Promise<BookingAdminSettings> => {
    const file = (request.params as { file?: string }).file ?? '';
    await scoped(request, async (tx) => {
      const [locked] = await tx.select().from(businessPublicProfiles).where(eq(businessPublicProfiles.businessId, request.user.bid)).for('update');
      if (!locked || !locked.galleryFiles.includes(file)) throw notFound();
      await tx.update(businessPublicProfiles).set({ galleryFiles: locked.galleryFiles.filter((f) => f !== file), updatedAt: new Date() }).where(eq(businessPublicProfiles.businessId, request.user.bid));
    });
    await removeMedia(ctx.media, file);
    return scoped(request, (tx) => adminSettings(tx, request.user.bid));
  });

  /* ---------- Dirección de la página ---------- */

  /** ¿Está libre la dirección? Ni la usa otro negocio ni es una dirección anterior de otro (esas siguen reservadas para redirigir). */
  async function slugTakenByOthers(slug: string, businessId: string): Promise<boolean> {
    const [current] = await db.select({ id: businesses.id }).from(businesses).where(and(eq(businesses.slug, slug), ne(businesses.id, businessId))).limit(1);
    if (current) return true;
    const [old] = await db.select({ id: businessSlugHistory.businessId }).from(businessSlugHistory).where(and(eq(businessSlugHistory.slug, slug), ne(businessSlugHistory.businessId, businessId))).limit(1);
    return Boolean(old);
  }

  app.get('/booking/slug/check', async (request): Promise<{ slug: string; available: boolean; reason?: string }> => {
    const { slug: raw } = parse(slugCheckQuery, request.query);
    const parsed = slugSchema.safeParse(raw);
    if (!parsed.success) return { slug: raw, available: false, reason: parsed.error.issues[0]?.message ?? 'slug_invalid' };
    const taken = await slugTakenByOthers(parsed.data, request.user.bid);
    return taken ? { slug: parsed.data, available: false, reason: 'slug_taken' } : { slug: parsed.data, available: true };
  });

  app.put('/booking/slug', async (request): Promise<{ slug: string }> => {
    const { slug } = parse(z.object({ slug: slugSchema }), request.body);
    const businessId = request.user.bid;
    try {
      await db.transaction(async (tx) => {
        const [business] = await tx.select({ slug: businesses.slug }).from(businesses).where(eq(businesses.id, businessId)).for('update');
        if (!business) throw notFound();
        if (business.slug === slug) return;
        if (await slugTakenByOthers(slug, businessId)) throw new AppError(409, 'slug_taken');
        // La dirección anterior sigue funcionando (redirige a la nueva) y ya no puede tomarla nadie más.
        await tx.insert(businessSlugHistory).values({ slug: business.slug, businessId }).onConflictDoNothing();
        await tx.delete(businessSlugHistory).where(and(eq(businessSlugHistory.slug, slug), eq(businessSlugHistory.businessId, businessId)));
        await tx.update(businesses).set({ slug }).where(eq(businesses.id, businessId));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'slug_taken');
      throw error;
    }
    return { slug };
  });

  /* ---------- Días cerrados ---------- */

  const toClosure = (row: typeof businessClosures.$inferSelect): ClosureDto => ({ id: row.id, date: row.date, reason: row.reason });

  app.get('/booking/closures', async (request): Promise<ClosureDto[]> =>
    scoped(request, async (tx) => (await tx.select().from(businessClosures).where(eq(businessClosures.businessId, request.user.bid)).orderBy(asc(businessClosures.date))).map(toClosure)),
  );

  app.post('/booking/closures', async (request, reply) => {
    const input = parse(closureInputSchema, request.body);
    const row = await scoped(request, async (tx) => {
      const [saved] = await tx
        .insert(businessClosures)
        .values({ businessId: request.user.bid, date: input.date, reason: input.reason })
        .onConflictDoUpdate({ target: [businessClosures.businessId, businessClosures.date], set: { reason: input.reason } })
        .returning();
      return saved!;
    });
    return reply.status(201).send(toClosure(row));
  });

  app.delete('/booking/closures/:id', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    const deleted = await scoped(request, (tx) => tx.delete(businessClosures).where(and(eq(businessClosures.id, id), eq(businessClosures.businessId, request.user.bid))).returning({ id: businessClosures.id }));
    if (deleted.length === 0) throw notFound();
    return reply.status(204).send();
  });

  /* ---------- Profesionales (dueño y empleados que atienden) ---------- */

  async function requirePerson(tx: Tx, businessId: string, userId: string): Promise<void> {
    const [row] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.businessId, businessId), eq(users.active, true))).limit(1);
    if (!row) throw notFound();
  }

  app.get('/professionals', async (request): Promise<ProfessionalDto[]> => scoped(request, (tx) => loadProfessionals(tx, request.user.bid)));

  app.patch('/professionals/:id', async (request): Promise<ProfessionalDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(professionalInputSchema, request.body);
    return scoped(request, async (tx) => {
      await requirePerson(tx, request.user.bid, id);
      const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      await tx
        .insert(employeeProfiles)
        .values({ userId: id, businessId: request.user.bid, ...changes })
        .onConflictDoUpdate({ target: employeeProfiles.userId, set: { ...changes, updatedAt: new Date() } });
      return (await loadProfessionals(tx, request.user.bid, id))[0]!;
    });
  });

  app.put('/professionals/:id/photo', async (request): Promise<ProfessionalDto> => {
    const id = uuid((request.params as { id?: string }).id);
    await checkPhotoLimit(request);
    const part = await request.file();
    if (!part) throw new AppError(400, 'photo_invalid');
    const buffer = await part.toBuffer();
    // Opcional siempre: recorte cuadrado centrado, 400×400 y WebP, sin importar el tamaño ni la orientación de lo que llegó.
    // (El mismo código 'photo_invalid' cubre tipo inválido y más de 5 MB, igual que en el resto de subidas de fotos.)
    const file = await saveAvatarImage(ctx.media, buffer);
    if (!file) throw new AppError(400, 'photo_invalid');
    try {
      const { previous, dto } = await scoped(request, async (tx) => {
        await requirePerson(tx, request.user.bid, id);
        const [existing] = await tx.select({ photoFile: employeeProfiles.photoFile }).from(employeeProfiles).where(eq(employeeProfiles.userId, id)).limit(1);
        await tx.insert(employeeProfiles).values({ userId: id, businessId: request.user.bid, photoFile: file }).onConflictDoUpdate({ target: employeeProfiles.userId, set: { photoFile: file, updatedAt: new Date() } });
        return { previous: existing?.photoFile ?? null, dto: (await loadProfessionals(tx, request.user.bid, id))[0]! };
      });
      // Se borra la anterior DESPUÉS de confirmar la nueva: si algo falla antes, la persona conserva la foto que ya tenía.
      await removeMedia(ctx.media, previous);
      return dto;
    } catch (error) {
      await removeMedia(ctx.media, file);
      throw error;
    }
  });

  app.delete('/professionals/:id/photo', async (request): Promise<ProfessionalDto> => {
    const id = uuid((request.params as { id?: string }).id);
    await checkPhotoLimit(request);
    const { previous, dto } = await scoped(request, async (tx) => {
      await requirePerson(tx, request.user.bid, id);
      const [existing] = await tx.select({ photoFile: employeeProfiles.photoFile }).from(employeeProfiles).where(eq(employeeProfiles.userId, id)).limit(1);
      if (existing?.photoFile) await tx.update(employeeProfiles).set({ photoFile: null, updatedAt: new Date() }).where(eq(employeeProfiles.userId, id));
      return { previous: existing?.photoFile ?? null, dto: (await loadProfessionals(tx, request.user.bid, id))[0]! };
    });
    await removeMedia(ctx.media, previous);
    return dto;
  });

  app.put('/professionals/:id/schedule', async (request): Promise<ProfessionalDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const { blocks } = parse(employeeScheduleInputSchema, request.body);
    return scoped(request, async (tx) => {
      await requirePerson(tx, request.user.bid, id);
      await tx.delete(employeeSchedules).where(and(eq(employeeSchedules.userId, id), eq(employeeSchedules.businessId, request.user.bid)));
      if (blocks.length > 0) await tx.insert(employeeSchedules).values(blocks.map((b) => ({ businessId: request.user.bid, userId: id, weekday: b.weekday, startTime: b.from, endTime: b.to })));
      return (await loadProfessionals(tx, request.user.bid, id))[0]!;
    });
  });

  app.put('/professionals/:id/services', async (request): Promise<ProfessionalDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const { services } = parse(professionalServicesInputSchema, request.body);
    const wanted = [...new Set(services.map((s) => s.itemId.toLowerCase()))];
    return scoped(request, async (tx) => {
      await requirePerson(tx, request.user.bid, id);
      if (wanted.length > 0) {
        const found = await tx.select({ id: items.id }).from(items).where(and(eq(items.businessId, request.user.bid), eq(items.kind, 'service'), inArray(items.id, wanted)));
        if (found.length !== wanted.length) throw notFound();
      }
      await tx.delete(employeeServices).where(and(eq(employeeServices.userId, id), eq(employeeServices.businessId, request.user.bid)));
      if (services.length > 0) {
        await tx
          .insert(employeeServices)
          .values(services.map((s) => ({ businessId: request.user.bid, userId: id, itemId: s.itemId.toLowerCase(), priceOverride: s.priceOverride, durationOverride: s.durationOverride })))
          .onConflictDoNothing();
      }
      return (await loadProfessionals(tx, request.user.bid, id))[0]!;
    });
  });

  /* ---------- Ausencias ---------- */

  const toTimeOff = (row: typeof employeeTimeOff.$inferSelect): TimeOffDto => ({ id: row.id, userId: row.userId, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), reason: row.reason });
  /** Cada quien gestiona sus propias ausencias; con "ver todas las agendas" (o gestionar la página), las de cualquiera. */
  const mayManageTimeOff = (request: { actor: Parameters<typeof can>[0] & { id: string } }, userId: string) =>
    userId === request.actor.id || can(request.actor, 'agenda_all') || can(request.actor, 'public_page_manage');

  app.get('/professionals/:id/time-off', async (request): Promise<TimeOffDto[]> => {
    const id = uuid((request.params as { id?: string }).id);
    if (!mayManageTimeOff(request, id)) throw new AppError(403, 'forbidden');
    return scoped(request, async (tx) => {
      await requirePerson(tx, request.user.bid, id);
      const rows = await tx.select().from(employeeTimeOff).where(and(eq(employeeTimeOff.userId, id), eq(employeeTimeOff.businessId, request.user.bid))).orderBy(desc(employeeTimeOff.startsAt)).limit(200);
      return rows.map(toTimeOff);
    });
  });

  app.post('/professionals/:id/time-off', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(timeOffInputSchema, request.body);
    if (!mayManageTimeOff(request, id)) throw new AppError(403, 'forbidden');
    const row = await scoped(request, async (tx) => {
      await requirePerson(tx, request.user.bid, id);
      const [saved] = await tx.insert(employeeTimeOff).values({ businessId: request.user.bid, userId: id, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), reason: input.reason }).returning();
      return saved!;
    });
    return reply.status(201).send(toTimeOff(row));
  });

  app.delete('/time-off/:id', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    await scoped(request, async (tx) => {
      const [row] = await tx.select().from(employeeTimeOff).where(and(eq(employeeTimeOff.id, id), eq(employeeTimeOff.businessId, request.user.bid))).limit(1);
      if (!row) throw notFound();
      if (!mayManageTimeOff(request, row.userId)) throw new AppError(403, 'forbidden');
      await tx.delete(employeeTimeOff).where(and(eq(employeeTimeOff.id, id), eq(employeeTimeOff.businessId, request.user.bid)));
    });
    return reply.status(204).send();
  });

  /* ---------- Reseñas (moderación) ---------- */

  /** Moderación de reseñas, paginada por cursor (las más recientes primero); antes se cortaba en 200 sin avisar. */
  app.get('/booking/reviews', async (request): Promise<Page<ReviewDto>> => {
    const { status, limit, cursor } = parse(reviewsQuery, request.query);
    const after = decodeCursor(cursor, ['string', 'string']);
    return scoped(request, async (tx) => {
      const rows = await tx
        .select({ review: reviews, createdText: sql<string>`${reviews.createdAt}::text` })
        .from(reviews)
        .where(
          and(
            eq(reviews.businessId, request.user.bid),
            status ? eq(reviews.status, status) : undefined,
            after ? sql`(${reviews.createdAt}, ${reviews.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)` : undefined,
          ),
        )
        .orderBy(descNullsLast(reviews.createdAt), desc(reviews.id))
        .limit(limit + 1);
      return toPage(rows, limit, (row) => [row.createdText, row.review.id], (row) => toReviewDto(row.review));
    });
  });

  app.patch('/booking/reviews/:id', async (request): Promise<ReviewDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const { status } = parse(reviewPatch, request.body);
    return scoped(request, async (tx) => {
      const [row] = await tx.update(reviews).set({ status }).where(and(eq(reviews.id, id), eq(reviews.businessId, request.user.bid))).returning();
      if (!row) throw notFound();
      return toReviewDto(row);
    });
  });
}
