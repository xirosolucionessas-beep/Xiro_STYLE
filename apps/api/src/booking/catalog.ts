import type { BookingSelection } from '@xiro/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { AppError } from '../errors';
import { employeeProfiles, employeeSchedules, employeeServices, items, servicePackageEntries, servicePackages, serviceVariants, users } from '../db/schema';
import type { Tx } from './scope';

/** Una línea de lo reservado, con precio y duración de referencia (los del negocio, sin ajustes por profesional). */
export interface Line {
  kind: 'service' | 'package' | 'product';
  itemId: string | null;
  variantId: string | null;
  packageId: string | null;
  name: string;
  price: number;
  /** Minutos de atención (0 en productos). */
  minutes: number;
  cleanup: number;
  quantity: number;
  /** Artículos-servicio que exige la línea (para saber qué profesionales pueden atenderla). */
  serviceItemIds: string[];
}

export interface ResolvedSelection {
  lines: Line[];
  serviceItemIds: string[];
}

const unavailable = () => new AppError(400, 'item_not_bookable');

/**
 * Convierte lo elegido en líneas con datos REALES del negocio. Cada id se valida contra el negocio de la transacción:
 * un servicio, estilo, paquete o producto de otro negocio (o inexistente) responde igual, sin revelar si existe.
 * `publicOnly`: además exige que se pueda reservar en línea (servicios/productos `bookable`, paquetes visibles y activos).
 */
export async function resolveSelection(tx: Tx, businessId: string, selection: BookingSelection, options: { publicOnly: boolean }): Promise<ResolvedSelection> {
  const lines: Line[] = [];

  /* Servicios (con estilo opcional) */
  const serviceIds = [...new Set(selection.services.map((s) => s.itemId.toLowerCase()))];
  const serviceRows = serviceIds.length
    ? await tx.select().from(items).where(and(eq(items.businessId, businessId), inArray(items.id, serviceIds), eq(items.kind, 'service')))
    : [];
  const byId = new Map(serviceRows.map((row) => [row.id, row]));
  const variantIds = [...new Set(selection.services.flatMap((s) => (s.variantId ? [s.variantId.toLowerCase()] : [])))];
  const variantRows = variantIds.length ? await tx.select().from(serviceVariants).where(and(eq(serviceVariants.businessId, businessId), inArray(serviceVariants.id, variantIds))) : [];
  const variantById = new Map(variantRows.map((row) => [row.id, row]));

  for (const wanted of selection.services) {
    const item = byId.get(wanted.itemId.toLowerCase());
    if (!item || (options.publicOnly && !(item.bookable && item.published))) throw unavailable();
    const variant = wanted.variantId ? variantById.get(wanted.variantId.toLowerCase()) : undefined;
    if (wanted.variantId && (!variant || variant.itemId !== item.id || !variant.active)) throw unavailable();
    lines.push({
      kind: 'service',
      itemId: item.id,
      variantId: variant?.id ?? null,
      packageId: null,
      name: variant ? `${item.name} · ${variant.name}` : item.name,
      price: variant ? variant.price : item.price,
      minutes: variant?.durationMinutes ?? item.durationMinutes,
      cleanup: item.cleanupMinutes,
      quantity: 1,
      serviceItemIds: [item.id],
    });
  }

  /* Paquetes */
  const packageIds = [...new Set(selection.packages.map((p) => p.toLowerCase()))];
  if (packageIds.length > 0) {
    const packageRows = await tx.select().from(servicePackages).where(and(eq(servicePackages.businessId, businessId), inArray(servicePackages.id, packageIds), eq(servicePackages.active, true)));
    const entryRows = await tx.select().from(servicePackageEntries).where(and(eq(servicePackageEntries.businessId, businessId), inArray(servicePackageEntries.packageId, packageIds)));
    const entryItemIds = [...new Set(entryRows.map((e) => e.itemId))];
    const entryItems = entryItemIds.length ? await tx.select().from(items).where(and(eq(items.businessId, businessId), inArray(items.id, entryItemIds))) : [];
    const entryVariantIds = entryRows.flatMap((e) => (e.variantId ? [e.variantId] : []));
    const entryVariants = entryVariantIds.length ? await tx.select().from(serviceVariants).where(and(eq(serviceVariants.businessId, businessId), inArray(serviceVariants.id, entryVariantIds))) : [];
    const itemMap = new Map(entryItems.map((i) => [i.id, i]));
    const variantMap = new Map(entryVariants.map((v) => [v.id, v]));

    for (const id of packageIds) {
      const pkg = packageRows.find((p) => p.id === id);
      if (!pkg || (options.publicOnly && !pkg.visibleOnWeb)) throw unavailable();
      const entries = entryRows.filter((e) => e.packageId === pkg.id);
      if (entries.length === 0) throw unavailable();
      let sum = 0;
      let cleanup = 0;
      for (const entry of entries) {
        const item = itemMap.get(entry.itemId);
        if (!item || (options.publicOnly && !(item.bookable && item.published))) throw unavailable();
        sum += (entry.variantId ? variantMap.get(entry.variantId)?.durationMinutes : null) ?? item.durationMinutes;
        cleanup = Math.max(cleanup, item.cleanupMinutes);
      }
      lines.push({ kind: 'package', itemId: null, variantId: null, packageId: pkg.id, name: pkg.name, price: pkg.price, minutes: pkg.durationMinutes ?? sum, cleanup, quantity: 1, serviceItemIds: [...new Set(entries.map((e) => e.itemId))] });
    }
  }

  /* Productos apartados (se pagan en el local): solo precio y cantidad, nunca costo. */
  const productIds = [...new Set(selection.products.map((p) => p.itemId.toLowerCase()))];
  if (productIds.length > 0) {
    const productRows = await tx.select().from(items).where(and(eq(items.businessId, businessId), inArray(items.id, productIds), eq(items.kind, 'product')));
    const productMap = new Map(productRows.map((row) => [row.id, row]));
    for (const wanted of selection.products) {
      const product = productMap.get(wanted.itemId.toLowerCase());
      if (!product || (options.publicOnly && (!product.bookable || !product.published)) || product.stock < wanted.quantity) throw unavailable();
      lines.push({ kind: 'product', itemId: product.id, variantId: null, packageId: null, name: product.name, price: product.price, minutes: 0, cleanup: 0, quantity: wanted.quantity, serviceItemIds: [] });
    }
  }

  return { lines, serviceItemIds: [...new Set(lines.flatMap((l) => l.serviceItemIds))] };
}

export interface EligibleProfessional {
  id: string;
  name: string;
  publicName: string;
  sortOrder: number;
  isOwner: boolean;
  /** Bloques propios por día de la semana; null = sigue el horario del negocio. */
  schedule: Array<{ weekday: number; from: string; to: string }> | null;
  /** Ajustes propios por servicio (precio y/o duración). */
  overrides: Map<string, { price: number | null; minutes: number | null }>;
}

/**
 * Profesionales activos y reservables que pueden atender TODOS los servicios de la selección.
 * Regla: quien no tiene ningún servicio asignado hace TODOS los reservables; en cuanto se le asigna alguno, hace solo esos. `publicOnly` deja fuera a quienes el negocio oculta en la web.
 */
export async function eligibleProfessionals(tx: Tx, businessId: string, serviceItemIds: string[], options: { publicOnly: boolean }): Promise<EligibleProfessional[]> {
  const rows = await tx
    .select({ profile: employeeProfiles, name: users.name, role: users.role })
    .from(employeeProfiles)
    .innerJoin(users, and(eq(users.id, employeeProfiles.userId), eq(users.businessId, businessId)))
    .where(and(eq(employeeProfiles.businessId, businessId), eq(employeeProfiles.bookable, true), eq(users.active, true), options.publicOnly ? eq(employeeProfiles.visible, true) : undefined));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.profile.userId);
  const assignments = await tx.select().from(employeeServices).where(and(eq(employeeServices.businessId, businessId), inArray(employeeServices.userId, ids)));
  const schedules = await tx.select().from(employeeSchedules).where(and(eq(employeeSchedules.businessId, businessId), inArray(employeeSchedules.userId, ids)));

  const out: EligibleProfessional[] = [];
  for (const row of rows) {
    const id = row.profile.userId;
    const own = assignments.filter((a) => a.userId === id);
    const does = own.length === 0 || serviceItemIds.every((itemId) => own.some((a) => a.itemId === itemId));
    if (!does) continue;
    const mine = schedules.filter((s) => s.userId === id);
    out.push({
      id,
      name: row.name,
      publicName: row.profile.publicName || row.name,
      sortOrder: row.profile.sortOrder,
      isOwner: row.role === 'owner',
      schedule: mine.length > 0 ? mine.map((s) => ({ weekday: s.weekday, from: s.startTime, to: s.endTime })) : null,
      overrides: new Map(own.map((a) => [a.itemId, { price: a.priceOverride, minutes: a.durationOverride }])),
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.publicName.localeCompare(b.publicName));
}

export interface Priced {
  total: number;
  minutes: number;
  cleanup: number;
}

/** Precio total, minutos de atención y limpieza para UN profesional (aplica sus ajustes propios a servicios sin estilo). */
export function priceFor(selection: ResolvedSelection, pro: Pick<EligibleProfessional, 'overrides'>): Priced {
  let total = 0;
  let minutes = 0;
  let cleanup = 0;
  for (const line of selection.lines) {
    const own = line.kind === 'service' && !line.variantId && line.itemId ? pro.overrides.get(line.itemId) : undefined;
    total += (own?.price ?? line.price) * line.quantity;
    minutes += own?.minutes ?? line.minutes;
    cleanup = Math.max(cleanup, line.cleanup);
  }
  return { total, minutes, cleanup };
}
