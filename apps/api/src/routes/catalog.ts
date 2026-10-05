import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  categoryInputSchema,
  itemInputSchema,
  MAX_PHOTOS_PER_ITEM,
  REORDER_THRESHOLD,
  suggestStockStatus,
  type Category,
} from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { isForeignKeyViolation, isUniqueViolation } from '../db/errors';
import { categories, itemPhotos, items } from '../db/schema';
import { AppError, isUuid, notFound, parse, uuid } from '../errors';
import { removeMedia, saveImage } from '../media';
import { notifyLowStockIfNeeded } from '../push';
import { loadItems, redactItemForActor } from '../serializers';

/** Actualización de artículo: el contrato original más un campo OPCIONAL para detectar ediciones simultáneas. */
const itemUpdateSchema = itemInputSchema.extend({ expectedUpdatedAt: z.iso.datetime().optional() });

const stockAdjustmentSchema = z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'required') });

const bulkPublishSchema = z.object({ ids: z.array(z.string()).min(1).max(200), published: z.boolean() });

export function catalogRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const businessOf = (request: { user: { bid: string } }) => request.user.bid;

  /* ---------- Categorías ---------- */

  const listCategories = async (businessId: string): Promise<Category[]> =>
    db
      .select({ id: categories.id, name: categories.name, itemCount: sql<number>`count(${items.id})::int` })
      .from(categories)
      .leftJoin(items, eq(items.categoryId, categories.id))
      .where(eq(categories.businessId, businessId))
      .groupBy(categories.id)
      .orderBy(sql`lower(${categories.name})`);

  const getCategory = async (businessId: string, id: string): Promise<Category | undefined> => (await listCategories(businessId)).find((c) => c.id === id);

  app.get('/categories', async (request) => listCategories(businessOf(request)));

  app.post('/categories', async (request, reply) => {
    const { name } = parse(categoryInputSchema, request.body);
    const businessId = businessOf(request);
    try {
      const [row] = await db.insert(categories).values({ businessId, name }).returning({ id: categories.id, name: categories.name });
      return reply.status(201).send({ ...row!, itemCount: 0 } satisfies Category);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'category_exists');
      throw error;
    }
  });

  app.patch('/categories/:id', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const { name } = parse(categoryInputSchema, request.body);
    const businessId = businessOf(request);
    try {
      const updated = await db.update(categories).set({ name }).where(and(eq(categories.id, id), eq(categories.businessId, businessId))).returning({ id: categories.id });
      if (updated.length === 0) throw notFound();
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'category_exists');
      throw error;
    }
    return getCategory(businessId, id);
  });

  app.delete('/categories/:id', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    try {
      // La FK impide borrar una categoría con artículos aunque alguien cree uno justo ahora.
      const deleted = await db.delete(categories).where(and(eq(categories.id, id), eq(categories.businessId, businessOf(request)))).returning({ id: categories.id });
      if (deleted.length === 0) throw notFound();
    } catch (error) {
      if (isForeignKeyViolation(error)) throw new AppError(409, 'category_in_use');
      throw error;
    }
    return reply.status(204).send();
  });

  /* ---------- Artículos ---------- */

  async function requireItem(businessId: string, id: string) {
    const [item] = await loadItems(db, businessId, { id });
    if (!item) throw notFound();
    return item;
  }

  const itemValues = (input: ReturnType<typeof itemInputSchema.parse>) => ({
    categoryId: input.categoryId,
    name: input.name,
    shortDescription: input.shortDescription || input.description.slice(0, 60) || input.name,
    description: input.description,
    detail: input.detail,
    price: input.price,
    published: input.published,
    referenceCode: input.referenceCode,
    internalUnitCost: input.internalUnitCost,
    stock: input.stock,
    stockStatus: input.stockStatus ?? suggestStockStatus(input.stock),
    internalNotes: input.internalNotes,
  });

  /**
   * Campos de reserva (opcionales): las apps ya instaladas no los envían, y en ese caso el servidor conserva lo que ya
   * había. Si llega `kind`, la persona está decidiendo la clasificación: queda confirmada.
   */
  const bookingValues = (input: ReturnType<typeof itemInputSchema.parse>) => ({
    ...(input.kind !== undefined ? { kind: input.kind, kindConfirmed: true } : {}),
    ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
    ...(input.cleanupMinutes !== undefined ? { cleanupMinutes: input.cleanupMinutes } : {}),
    ...(input.bookable !== undefined ? { bookable: input.bookable } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  });

  const unknownCategory = () => new AppError(400, 'validation_error', 'Unknown category');

  app.get('/items', async (request) => (await loadItems(db, businessOf(request))).map((item) => redactItemForActor(item, request.actor)));

  app.get('/items/:id', async (request) => redactItemForActor(await requireItem(businessOf(request), uuid((request.params as { id?: string }).id)), request.actor));

  app.post('/items', async (request, reply) => {
    const input = parse(itemInputSchema, request.body);
    const businessId = businessOf(request);
    if (!isUuid(input.categoryId)) throw unknownCategory();
    try {
      // La FK compuesta (categoría, negocio) hace que la propia base de datos rechace categorías de otro negocio.
      // Sin `kind` explícito: con existencias se trata como producto; si no, como servicio (queda "sin confirmar").
      const inferred = input.kind === undefined ? { kind: input.stock > 0 ? 'product' : 'service' } : {};
      const [row] = await db.insert(items).values({ businessId, ...itemValues(input), ...inferred, ...bookingValues(input) }).returning({ id: items.id });
      return reply.status(201).send(await requireItem(businessId, row!.id));
    } catch (error) {
      if (isForeignKeyViolation(error)) throw unknownCategory();
      throw error;
    }
  });

  app.put('/items/:id', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const { expectedUpdatedAt, ...input } = parse(itemUpdateSchema, request.body);
    const businessId = businessOf(request);
    if (!isUuid(input.categoryId)) throw unknownCategory();

    let updated: Array<{ id: string }>;
    try {
      updated = await db
        .update(items)
        .set({ ...itemValues(input as ReturnType<typeof itemInputSchema.parse>), ...bookingValues(input as ReturnType<typeof itemInputSchema.parse>), updatedAt: new Date() })
        .where(
          and(
            eq(items.id, id),
            eq(items.businessId, businessId),
            // Concurrencia optimista (opcional): solo se aplica si nadie modificó el artículo desde que se leyó.
            expectedUpdatedAt ? sql`date_trunc('milliseconds', ${items.updatedAt}) = ${new Date(expectedUpdatedAt)}` : undefined,
          ),
        )
        .returning({ id: items.id });
    } catch (error) {
      if (isForeignKeyViolation(error)) throw unknownCategory();
      throw error;
    }

    if (updated.length === 0) {
      await requireItem(businessId, id); // 404 si no existe
      throw new AppError(409, 'conflict'); // existe pero cambió desde que se leyó
    }
    return requireItem(businessId, id);
  });

  /**
   * Publicar o despublicar varios artículos a la vez (selección múltiple en Inventario): el catálogo y el artículo son
   * la MISMA fila, así que esto es lo único que hace falta — no hay una copia aparte que "sincronizar" después.
   */
  app.post('/items/bulk-publish', async (request) => {
    const { ids, published } = parse(bulkPublishSchema, request.body);
    const businessId = businessOf(request);
    const validIds = [...new Set(ids)].filter(isUuid).map((id) => id.toLowerCase());
    if (validIds.length === 0) return { updated: 0 };
    const updated = await db
      .update(items)
      .set({ published, updatedAt: new Date() })
      .where(and(inArray(items.id, validIds), eq(items.businessId, businessId)))
      .returning({ id: items.id });
    return { updated: updated.length };
  });

  /**
   * Ajuste RELATIVO de stock, atómico: `stock = stock + delta` se evalúa dentro de la base de datos, así que dos ventas
   * simultáneas nunca se pisan ni dejan el stock en negativo (a diferencia de leer, calcular y guardar).
   */
  app.post('/items/:id/stock-adjustments', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const { delta } = parse(stockAdjustmentSchema, request.body);
    const businessId = businessOf(request);
    const next = sql`${items.stock} + ${delta}`;

    const [updated] = await db
      .update(items)
      .set({
        stock: next,
        stockStatus: sql`case when ${next} <= 0 then 'out_of_stock' when ${next} <= ${REORDER_THRESHOLD} then 'reorder' else 'available' end`,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, id), eq(items.businessId, businessId), sql`${items.stock} + ${delta} >= 0`, sql`${items.stock} + ${delta} <= 1000000`))
      .returning({ id: items.id, name: items.name, stockStatus: items.stockStatus });

    if (!updated) {
      await requireItem(businessId, id);
      throw new AppError(409, 'insufficient_stock');
    }
    // No-op si no quedó bajo/agotado (ver notifyLowStockIfNeeded); el propio dueño/empleado que ajustó ya lo sabe.
    void notifyLowStockIfNeeded(ctx, businessId, updated);
    return requireItem(businessId, id);
  });

  app.delete('/items/:id', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const files = await db.transaction(async (tx) => {
      const found = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, id), eq(items.businessId, businessId))).for('update');
      if (found.length === 0) throw notFound();
      const photos = await tx.select({ file: itemPhotos.file }).from(itemPhotos).where(eq(itemPhotos.itemId, id));
      await tx.delete(items).where(eq(items.id, id)); // las fotos se borran en cascada
      return photos.map((photo) => photo.file);
    });
    await Promise.all(files.map((file) => removeMedia(config.mediaDir, file)));
    return reply.status(204).send();
  });

  /* ---------- Fotos ---------- */

  app.post('/items/:id/photos', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    await requireItem(businessId, id);

    const part = await request.file();
    if (!part) throw new AppError(400, 'photo_invalid');
    const file = await saveImage(config.mediaDir, await part.toBuffer());
    if (!file) throw new AppError(400, 'photo_invalid');

    try {
      // Bloqueo de fila: el límite de fotos y la posición se calculan sin carreras entre subidas simultáneas.
      await db.transaction(async (tx) => {
        const locked = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, id), eq(items.businessId, businessId))).for('update');
        if (locked.length === 0) throw notFound();
        const existing = await tx.select({ position: itemPhotos.position }).from(itemPhotos).where(eq(itemPhotos.itemId, id));
        if (existing.length >= MAX_PHOTOS_PER_ITEM) throw new AppError(400, 'photo_limit');
        const position = existing.reduce((max, photo) => Math.max(max, photo.position), -1) + 1;
        await tx.insert(itemPhotos).values({ itemId: id, file, position });
        await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, id));
      });
    } catch (error) {
      await removeMedia(config.mediaDir, file);
      throw error;
    }
    return reply.status(201).send(await requireItem(businessId, id));
  });

  app.delete('/items/:id/photos/:photoId', async (request) => {
    const params = request.params as { id?: string; photoId?: string };
    const id = uuid(params.id);
    const photoId = uuid(params.photoId);
    const businessId = businessOf(request);

    const file = await db.transaction(async (tx) => {
      const locked = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, id), eq(items.businessId, businessId))).for('update');
      if (locked.length === 0) throw notFound();
      const [photo] = await tx.delete(itemPhotos).where(and(eq(itemPhotos.id, photoId), eq(itemPhotos.itemId, id))).returning({ file: itemPhotos.file });
      if (!photo) throw notFound();
      await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, id));
      return photo.file;
    });
    await removeMedia(config.mediaDir, file);
    return requireItem(businessId, id);
  });

  app.post('/items/:id/photos/:photoId/primary', async (request) => {
    const params = request.params as { id?: string; photoId?: string };
    const id = uuid(params.id);
    const photoId = uuid(params.photoId);
    const businessId = businessOf(request);

    await db.transaction(async (tx) => {
      const locked = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, id), eq(items.businessId, businessId))).for('update');
      if (locked.length === 0) throw notFound();
      const photos = await tx.select({ id: itemPhotos.id }).from(itemPhotos).where(eq(itemPhotos.itemId, id)).orderBy(asc(itemPhotos.position));
      if (!photos.some((photo) => photo.id === photoId)) throw notFound();
      const order = [photoId, ...photos.map((photo) => photo.id).filter((pid) => pid !== photoId)];
      for (const [position, pid] of order.entries()) await tx.update(itemPhotos).set({ position }).where(eq(itemPhotos.id, pid));
      await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, id));
    });
    return requireItem(businessId, id);
  });
}
