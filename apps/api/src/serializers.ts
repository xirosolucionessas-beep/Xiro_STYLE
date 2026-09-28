import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  businessHoursSchema,
  can,
  defaultBusinessHours,
  EMPLOYEE_PERMISSIONS,
  normalizePermissions,
  type Actor,
  type Business,
  type Client,
  type Employee,
  type Item,
  type PublicItem,
  type Role,
  type User,
} from '@xiro/shared';
import type { DbExecutor } from './db/client';
import { categories, itemPhotos, items, type businesses, type clients, type users } from './db/schema';
import { mediaUrl } from './media';

export type BusinessRow = typeof businesses.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;

export function toBusiness(row: BusinessRow): Business {
  const parsedHours = businessHoursSchema.safeParse(row.hours);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type as Business['type'],
    whatsapp: row.whatsapp,
    address: row.address,
    city: row.city,
    country: row.country,
    currency: row.currency as Business['currency'],
    timezone: row.timezone,
    hours: parsedHours.success ? parsedHours.data : defaultBusinessHours(),
    logoUrl: row.logoFile ? mediaUrl(row.logoFile) : null,
  };
}

export function toUser(row: UserRow): User {
  const role: Role = row.role === 'employee' ? 'employee' : 'owner';
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    language: row.language as User['language'],
    theme: row.theme as User['theme'],
    businessId: row.businessId,
    role,
    permissions: role === 'owner' ? [...EMPLOYEE_PERMISSIONS] : normalizePermissions(row.permissions),
  };
}

export function toEmployee(row: UserRow): Employee {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, permissions: normalizePermissions(row.permissions), active: row.active, createdAt: row.createdAt.toISOString() };
}

/** Sin `catalog_manage` no se ve el costo ni las notas internas (datos del negocio, no de quien atiende). */
export function redactItemForActor(item: Item, actor: Actor): Item {
  return can(actor, 'catalog_manage') ? item : { ...item, internalUnitCost: 0, internalNotes: '' };
}

export function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadItems(db: DbExecutor, businessId: string, options: { id?: string; publishedOnly?: boolean } = {}): Promise<Item[]> {
  const rows = await db
    .select({ item: items, categoryName: categories.name })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .where(and(eq(items.businessId, businessId), options.id ? eq(items.id, options.id) : undefined, options.publishedOnly ? eq(items.published, true) : undefined))
    .orderBy(desc(items.updatedAt), asc(items.name));
  if (rows.length === 0) return [];

  const photos = await db
    .select({ id: itemPhotos.id, itemId: itemPhotos.itemId, file: itemPhotos.file })
    .from(itemPhotos)
    .where(inArray(itemPhotos.itemId, rows.map((row) => row.item.id)))
    .orderBy(asc(itemPhotos.position));
  const byItem = new Map<string, Array<{ id: string; file: string }>>();
  for (const photo of photos) {
    const list = byItem.get(photo.itemId) ?? [];
    list.push(photo);
    byItem.set(photo.itemId, list);
  }

  return rows.map(({ item, categoryName }) => ({
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    categoryName,
    shortDescription: item.shortDescription,
    description: item.description,
    detail: item.detail,
    price: item.price,
    published: item.published,
    referenceCode: item.referenceCode,
    internalUnitCost: item.internalUnitCost,
    stock: item.stock,
    stockStatus: item.stockStatus as Item['stockStatus'],
    internalNotes: item.internalNotes,
    photos: (byItem.get(item.id) ?? []).map((photo) => ({ id: photo.id, url: mediaUrl(photo.file) })),
    updatedAt: item.updatedAt.toISOString(),
    kind: item.kind as Item['kind'],
    durationMinutes: item.durationMinutes,
    cleanupMinutes: item.cleanupMinutes,
    bookable: item.bookable,
    kindConfirmed: item.kindConfirmed,
    sortOrder: item.sortOrder,
  }));
}

/**
 * Lista blanca explícita: aquí se decide qué sale al catálogo público.
 * Nunca añadir costo, stock, notas internas, referencia, usuarios ni clientes.
 */
export function toPublicItem(item: Item): PublicItem {
  const [first, ...rest] = item.photos;
  return {
    id: item.id,
    name: item.name,
    category: item.categoryName,
    shortDescription: item.shortDescription,
    description: item.description,
    detail: item.detail,
    price: item.price,
    image: first?.url ?? null,
    gallery: rest.slice(0, 3).map((p) => p.url),
  };
}
