import {
  PUBLIC_SECTIONS,
  roundCoord,
  type BookingReadiness,
  type ProfessionalDto,
  type PublicBookingCatalog,
  type PublicBookingProfile,
  type PublicReviewDto,
  type PublicSection,
  type PublicTeamMemberDto,
  type ReviewDto,
  type ScheduleBlock,
} from '@xiro/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import {
  businessPublicProfiles,
  businessSlugHistory,
  businesses,
  categories,
  employeeProfiles,
  employeeSchedules,
  employeeServices,
  itemPhotos,
  items,
  reviews,
  servicePackageEntries,
  servicePackages,
  serviceVariants,
  users,
} from '../db/schema';
import { mediaUrl } from '../media';
import type { BusinessRow } from '../serializers';
import type { BookingContext } from './availability';
import type { Tx } from './scope';
import { blocksForDate } from './slots';
import { addDays, localDate, localMinutes, zonedInstant } from './time';

/**
 * Resuelve la dirección de una página. Si es una dirección anterior del negocio devuelve igualmente a ese negocio y
 * marca `redirected` (la página web responde con una redirección permanente a la vigente).
 * Consulta con la conexión normal: aún no se sabe de qué negocio se trata, así que no hay negocio activo para RLS.
 */
export async function resolveSlug(db: DbExecutor, slug: string): Promise<{ business: BusinessRow; redirected: boolean } | null> {
  const [current] = await db.select().from(businesses).where(eq(businesses.slug, slug)).limit(1);
  if (current) return { business: current, redirected: false };
  const [old] = await db.select({ businessId: businessSlugHistory.businessId }).from(businessSlugHistory).where(eq(businessSlugHistory.slug, slug)).limit(1);
  if (!old) return null;
  const [moved] = await db.select().from(businesses).where(eq(businesses.id, old.businessId)).limit(1);
  return moved ? { business: moved, redirected: true } : null;
}

export const allSections = (stored: Partial<Record<PublicSection, boolean>> | null | undefined): Record<PublicSection, boolean> =>
  Object.fromEntries(PUBLIC_SECTIONS.map((section) => [section, stored?.[section] !== false])) as Record<PublicSection, boolean>;

export async function loadProfileRow(tx: Tx | DbExecutor, businessId: string) {
  const [row] = await tx.select().from(businessPublicProfiles).where(eq(businessPublicProfiles.businessId, businessId)).limit(1);
  return row ?? null;
}

async function ratingOf(tx: Tx, businessId: string): Promise<{ average: number | null; count: number }> {
  const [row] = await tx
    .select({ average: sql<string | null>`avg(${reviews.rating})`, count: sql<number>`count(*)::int` })
    .from(reviews)
    .where(and(eq(reviews.businessId, businessId), eq(reviews.status, 'approved')));
  return { average: row?.average ? Math.round(Number(row.average) * 10) / 10 : null, count: row?.count ?? 0 };
}

/** ¿Está abierto ahora mismo (hora del negocio, día no cerrado)? */
export function isOpenNow(ctx: BookingContext, now: Date): boolean {
  const tz = ctx.business.timezone;
  const date = localDate(now, tz);
  if (ctx.closures.has(date)) return false;
  const minutes = localMinutes(now, tz);
  return blocksForDate(ctx.weekly, date).some((b) => minutes >= b.from && minutes < b.to);
}


/**
 * Cuándo cambia el estado del negocio: abierto → la hora de cierre del bloque actual; cerrado → la próxima apertura (hoy más
 * tarde o el próximo día abierto, hasta 14 días). Todo se calcula en la zona horaria del negocio y se entrega como instante UTC.
 */
export function openStatus(ctx: BookingContext, now: Date): { open: boolean; changesAt: string | null } {
  const tz = ctx.business.timezone;
  const today = localDate(now, tz);
  const minutes = localMinutes(now, tz);
  if (!ctx.closures.has(today)) {
    const blocks = blocksForDate(ctx.weekly, today);
    const current = blocks.find((b) => minutes >= b.from && minutes < b.to);
    if (current) return { open: true, changesAt: zonedInstant(today, current.to, tz).toISOString() };
    const later = blocks.filter((b) => b.from > minutes).sort((a, b) => a.from - b.from)[0];
    if (later) return { open: false, changesAt: zonedInstant(today, later.from, tz).toISOString() };
  }
  for (let ahead = 1; ahead <= 14; ahead += 1) {
    const date = addDays(today, ahead);
    if (ctx.closures.has(date)) continue;
    const first = blocksForDate(ctx.weekly, date).sort((a, b) => a.from - b.from)[0];
    if (first) return { open: false, changesAt: zonedInstant(date, first.from, tz).toISOString() };
  }
  return { open: false, changesAt: null };
}

/**
 * ¿Falta algo para que un cliente reserve en línea? Regla ÚNICA (la usan la página pública y el checklist del dueño):
 * al menos un servicio reservable y publicado, alguien activo que atienda, y algún día con horario. Los paquetes solo se
 * ofrecen si sus servicios son reservables, así que no hace falta contarlos aparte.
 */
export async function loadReadiness(tx: Tx, ctx: BookingContext, published: boolean): Promise<BookingReadiness> {
  const businessId = ctx.business.id;
  const [[services], [professionals]] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(items).where(and(eq(items.businessId, businessId), eq(items.kind, 'service'), eq(items.bookable, true), eq(items.published, true))),
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(employeeProfiles)
      .innerJoin(users, and(eq(users.id, employeeProfiles.userId), eq(users.businessId, businessId)))
      .where(and(eq(employeeProfiles.businessId, businessId), eq(employeeProfiles.bookable, true), eq(users.active, true))),
  ]);
  const bookableServices = services?.n ?? 0;
  const bookableProfessionals = professionals?.n ?? 0;
  const openDays = new Set(ctx.weekly.map((block) => block.weekday)).size;
  return { published, bookableServices, bookableProfessionals, openDays, ready: published && bookableServices > 0 && bookableProfessionals > 0 && openDays > 0 };
}

/** Lista blanca del perfil público: aquí se decide, campo por campo, lo que sale a Internet. */
export async function loadPublicProfile(tx: Tx, ctx: BookingContext, now: Date, captchaSiteKey: string | null, mapsEnabled = false): Promise<PublicBookingProfile> {
  const { business } = ctx;
  const profile = await loadProfileRow(tx, business.id);
  const sections = allSections(profile?.sections);
  const hasPin = sections.map && profile?.latitude != null && profile.longitude != null;
  // `v` cambia con el pin: el navegador guarda la imagen un rato y así no enseña el mapa del pin anterior tras moverlo.
  const mapImageUrl = mapsEnabled && hasPin ? `/api/public/booking/${business.slug}/map.png?v=${roundCoord(profile.latitude!)},${roundCoord(profile.longitude!)}` : null;
  const [rating, readiness] = await Promise.all([sections.reviews ? ratingOf(tx, business.id) : Promise.resolve({ average: null, count: 0 }), loadReadiness(tx, ctx, profile?.published ?? false)]);
  return {
    slug: business.slug,
    name: profile?.displayName || business.name,
    tagline: profile?.tagline ?? '',
    description: profile?.description ?? '',
    conditions: profile?.conditions ?? '',
    privacyPolicy: profile?.privacyPolicy ?? '',
    address: business.address,
    city: business.city,
    country: business.country,
    phone: profile?.phone || null,
    whatsapp: business.whatsapp,
    instagram: profile?.instagram ?? '',
    facebook: profile?.facebook ?? '',
    tiktok: profile?.tiktok ?? '',
    website: profile?.website ?? '',
    latitude: sections.map ? (profile?.latitude ?? null) : null,
    longitude: sections.map ? (profile?.longitude ?? null) : null,
    mapAddress: hasPin ? (profile?.mapAddress ?? '') : '',
    placeId: hasPin ? (profile?.placeId ?? null) : null,
    mapImageUrl,
    logoUrl: business.logoFile ? mediaUrl(business.logoFile) : null,
    coverUrl: profile?.coverFile ? mediaUrl(profile.coverFile) : null,
    gallery: sections.gallery ? (profile?.galleryFiles ?? []).map(mediaUrl) : [],
    timezone: business.timezone,
    currency: business.currency,
    sections,
    hours: ctx.weekly,
    openNow: isOpenNow(ctx, now),
    openStatus: openStatus(ctx, now),
    // Sin servicios o sin quien atienda la página no ofrece "Reservar" (y lo dice); `published` ya es cierto si se llegó hasta aquí.
    acceptsBookings: readiness.ready,
    rating,
    rules: {
      slotIntervalMinutes: ctx.settings.slotIntervalMinutes,
      maxDaysAhead: ctx.settings.maxDaysAhead,
      cancelUntilHours: ctx.settings.cancelUntilHours,
      maxModifications: ctx.settings.maxModifications,
      requireEmail: ctx.settings.requireEmail,
      customFields: ctx.settings.customFields,
    },
    captchaSiteKey,
  };
}

async function firstPhotos(tx: Tx, itemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (itemIds.length === 0) return out;
  const rows = await tx.select({ itemId: itemPhotos.itemId, file: itemPhotos.file }).from(itemPhotos).where(inArray(itemPhotos.itemId, itemIds)).orderBy(asc(itemPhotos.position));
  for (const row of rows) if (!out.has(row.itemId)) out.set(row.itemId, mediaUrl(row.file));
  return out;
}

/** Servicios, estilos, paquetes y productos que se pueden reservar en línea: solo precio, duración y presentación. */
export async function loadPublicCatalog(tx: Tx, businessId: string, sections: Record<PublicSection, boolean>): Promise<PublicBookingCatalog> {
  const rows = sections.services
    ? await tx
        .select({ item: items, categoryName: categories.name })
        .from(items)
        .innerJoin(categories, and(eq(categories.id, items.categoryId), eq(categories.businessId, businessId)))
        .where(and(eq(items.businessId, businessId), eq(items.kind, 'service'), eq(items.bookable, true), eq(items.published, true)))
        .orderBy(asc(items.sortOrder), asc(categories.name), asc(items.name))
    : [];
  const variants = rows.length > 0 ? await tx.select().from(serviceVariants).where(and(eq(serviceVariants.businessId, businessId), eq(serviceVariants.active, true))).orderBy(asc(serviceVariants.sortOrder), asc(serviceVariants.name)) : [];
  const photos = await firstPhotos(tx, rows.map((r) => r.item.id));
  const services = rows.map(({ item, categoryName }) => ({
    id: item.id,
    name: item.name,
    category: categoryName,
    description: item.shortDescription || item.description,
    price: item.price,
    durationMinutes: item.durationMinutes,
    image: photos.get(item.id) ?? null,
    variants: variants
      .filter((v) => v.itemId === item.id)
      .map((v) => ({ id: v.id, name: v.name, description: v.description, price: v.price, durationMinutes: v.durationMinutes ?? item.durationMinutes })),
  }));

  const packageRows = sections.services
    ? await tx.select().from(servicePackages).where(and(eq(servicePackages.businessId, businessId), eq(servicePackages.active, true), eq(servicePackages.visibleOnWeb, true))).orderBy(asc(servicePackages.sortOrder), asc(servicePackages.name))
    : [];
  const entries = packageRows.length > 0 ? await tx.select().from(servicePackageEntries).where(and(eq(servicePackageEntries.businessId, businessId), inArray(servicePackageEntries.packageId, packageRows.map((p) => p.id)))) : [];
  const entryItems = entries.length > 0 ? await tx.select().from(items).where(and(eq(items.businessId, businessId), inArray(items.id, [...new Set(entries.map((e) => e.itemId))]))) : [];
  const itemById = new Map(entryItems.map((i) => [i.id, i]));
  const packages = packageRows
    .map((pkg) => {
      const own = entries.filter((e) => e.packageId === pkg.id);
      const bookable = own.length > 0 && own.every((e) => itemById.get(e.itemId)?.bookable && itemById.get(e.itemId)?.published);
      return { pkg, own, bookable };
    })
    .filter((entry) => entry.bookable)
    .map(({ pkg, own }) => ({
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      price: pkg.price,
      durationMinutes: pkg.durationMinutes ?? own.reduce((sum, e) => sum + (itemById.get(e.itemId)?.durationMinutes ?? 0), 0),
      services: own.map((e) => itemById.get(e.itemId)?.name ?? ''),
      image: null,
    }));

  const productRows = sections.products
    ? await tx.select().from(items).where(and(eq(items.businessId, businessId), eq(items.kind, 'product'), eq(items.bookable, true), eq(items.published, true))).orderBy(asc(items.sortOrder), asc(items.name))
    : [];
  const productPhotos = await firstPhotos(tx, productRows.map((p) => p.id));
  const products = productRows.map((p) => ({ id: p.id, name: p.name, description: p.shortDescription || p.description, price: p.price, image: productPhotos.get(p.id) ?? null, inStock: p.stock > 0 }));

  return { services, packages, products };
}

/** Equipo visible en la web. Nunca correo, celular ni notas: nombre público, presentación y foto. */
export async function loadPublicTeam(tx: Tx, businessId: string): Promise<PublicTeamMemberDto[]> {
  const rows = await tx
    .select({ profile: employeeProfiles, name: users.name })
    .from(employeeProfiles)
    .innerJoin(users, and(eq(users.id, employeeProfiles.userId), eq(users.businessId, businessId)))
    .where(and(eq(employeeProfiles.businessId, businessId), eq(employeeProfiles.bookable, true), eq(employeeProfiles.visible, true), eq(users.active, true)))
    .orderBy(asc(employeeProfiles.sortOrder), asc(users.name));
  const assignments = rows.length > 0 ? await tx.select().from(employeeServices).where(and(eq(employeeServices.businessId, businessId), inArray(employeeServices.userId, rows.map((r) => r.profile.userId)))) : [];
  return rows.map(({ profile, name }) => ({
    id: profile.userId,
    name: profile.publicName || name,
    bio: profile.bio,
    photoUrl: profile.photoFile ? mediaUrl(profile.photoFile) : null,
    serviceIds: assignments.filter((a) => a.userId === profile.userId).map((a) => a.itemId),
  }));
}

export async function loadPublicReviews(tx: Tx, businessId: string, limit = 20): Promise<PublicReviewDto[]> {
  const rows = await tx.select().from(reviews).where(and(eq(reviews.businessId, businessId), eq(reviews.status, 'approved'))).orderBy(desc(reviews.createdAt)).limit(limit);
  return rows.map((r) => ({ rating: r.rating, comment: r.comment, authorName: r.authorName, createdAt: r.createdAt.toISOString() }));
}

export const toReviewDto = (row: typeof reviews.$inferSelect): ReviewDto => ({
  id: row.id,
  rating: row.rating,
  comment: row.comment,
  authorName: row.authorName,
  status: row.status as ReviewDto['status'],
  createdAt: row.createdAt.toISOString(),
});

/** Todas las personas del negocio que pueden atender (dueño y empleados activos) con su perfil de atención, horario y servicios. */
export async function loadProfessionals(tx: Tx, businessId: string, onlyUserId?: string): Promise<ProfessionalDto[]> {
  const people = await tx
    .select({ user: users, profile: employeeProfiles })
    .from(users)
    .leftJoin(employeeProfiles, and(eq(employeeProfiles.userId, users.id), eq(employeeProfiles.businessId, businessId)))
    .where(and(eq(users.businessId, businessId), eq(users.active, true), onlyUserId ? eq(users.id, onlyUserId) : undefined))
    .orderBy(asc(employeeProfiles.sortOrder), asc(users.name));
  if (people.length === 0) return [];
  const ids = people.map((p) => p.user.id);
  const schedules = await tx.select().from(employeeSchedules).where(and(eq(employeeSchedules.businessId, businessId), inArray(employeeSchedules.userId, ids))).orderBy(asc(employeeSchedules.weekday), asc(employeeSchedules.startTime));
  const assignments = await tx.select().from(employeeServices).where(and(eq(employeeServices.businessId, businessId), inArray(employeeServices.userId, ids)));
  return people.map(({ user, profile }) => ({
    id: user.id,
    name: user.name,
    publicName: profile?.publicName || user.name,
    bio: profile?.bio ?? '',
    photoUrl: profile?.photoFile ? mediaUrl(profile.photoFile) : null,
    bookable: profile?.bookable ?? false,
    visible: profile?.visible ?? true,
    sortOrder: profile?.sortOrder ?? 0,
    isOwner: user.role === 'owner',
    schedule: schedules.filter((s) => s.userId === user.id).map((s): ScheduleBlock => ({ weekday: s.weekday, from: s.startTime, to: s.endTime })),
    serviceIds: assignments.filter((a) => a.userId === user.id).map((a) => a.itemId),
    serviceOverrides: assignments.filter((a) => a.userId === user.id).map((a) => ({ itemId: a.itemId, priceOverride: a.priceOverride, durationOverride: a.durationOverride })),
  }));
}

