import { z } from 'zod';
import { ITEM_KINDS } from './schemas';
import { STOCK_STATUSES } from './stock';

/**
 * Paginación por cursor de los listados (clientes, artículos, registros de servicio, fidelización, reseñas, canjes,
 * conversaciones). El cursor es opaco para el cliente: lo arma y lo interpreta solo la API (orden estable por clave +
 * id), así que no hay saltos ni duplicados aunque alguien agregue datos mientras se navega.
 */
export const PAGE_DEFAULT_LIMIT = 50;
export const PAGE_MAX_LIMIT = 100;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_MAX_LIMIT).default(PAGE_DEFAULT_LIMIT),
  cursor: z.string().trim().min(1).max(512).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;
/** Lo que envía un cliente: `limit` y `cursor` opcionales. */
export type PageParams = z.input<typeof pageQuerySchema>;

export interface Page<T> {
  data: T[];
  /** `null` = no hay más páginas. */
  nextCursor: string | null;
}

/* ---------- Clientes ---------- */

export const clientsQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  /** `name` (A–Z, el directorio) o `recent` (los últimos creados primero: actividad del Inicio). */
  sort: z.enum(['name', 'recent']).default('name'),
  /** Solo los creados en [createdFrom, createdTo) (p. ej. "clientes nuevos hoy" desde el Inicio). */
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
});
export type ClientsQuery = z.input<typeof clientsQuerySchema>;

export const clientsSummaryQuerySchema = z.object({
  /** Rango opcional [from, to) para "clientes nuevos del periodo" (Reportes). */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export interface ClientsSummary {
  total: number;
  newToday: number;
  newYesterday: number;
  newThisMonth: number;
  /** Clientes con algún servicio registrado (no anulado) en los últimos 30 días. */
  active30d: number;
  /** Clientes creados en [from, to) si se pidió un rango; si no, `null`. */
  newInRange: number | null;
}

/* ---------- Artículos (catálogo e inventario) ---------- */

// En la URL llega como texto ("true"/"false"); desde código se puede pasar un booleano.
const booleanParam = z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true');

export const itemsQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  categoryId: z.string().uuid().optional(),
  kind: z.enum(ITEM_KINDS).optional(),
  stockStatus: z.enum(STOCK_STATUSES).optional(),
  /** Por reponer o agotados (lo que el Inicio llama "bajo inventario"). */
  low: booleanParam.optional(),
  published: booleanParam.optional(),
  bookable: booleanParam.optional(),
  /** Solo artículos que llevan inventario (productos y los aún sin clasificar), igual que la pantalla Inventario. */
  tracked: booleanParam.optional(),
  /** `catalog` = el orden del negocio (el de siempre); `stock` = menos unidades primero (alertas de inventario). */
  sort: z.enum(['catalog', 'stock']).default('catalog'),
});
export type ItemsQuery = z.input<typeof itemsQuerySchema>;

export interface ItemsSummary {
  total: number;
  published: number;
  hidden: number;
  /** Precio promedio de todos los artículos; `null` si no hay ninguno. */
  averagePrice: number | null;
  /** Artículos que llevan inventario, por estado. */
  stock: { total: number; available: number; reorder: number; outOfStock: number };
  /** Valor a costo (unidades × costo) de lo que lleva inventario con costo cargado; `null` si nada lo tiene. */
  inventoryValue: number | null;
}

/* ---------- Fidelización ---------- */

export interface LoyaltySummary {
  /** Clientes que ya alcanzaron la meta (premio disponible). */
  rewardsAvailable: number;
  /** Canjes registrados; `null` para quien no puede ver el historial de canjes. */
  redeemed: number | null;
}

/* ---------- Registros de servicio ---------- */

export const serviceRecordsQuerySchema = pageQuerySchema.extend({
  clientId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ServiceRecordsQuery = z.input<typeof serviceRecordsQuerySchema>;

export const serviceRecordsSummaryQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  /** Solo servicios o solo productos (el Inicio web separa "Servicios hoy" de "Ventas hoy"). */
  kind: z.enum(ITEM_KINDS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Visitas por cliente para las filas visibles del directorio (máximo una página). */
export const serviceRecordsByClientQuerySchema = z.object({
  clientIds: z
    .string()
    .max(100 * 37)
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(100)),
});

export interface ClientVisits {
  clientId: string;
  count: number;
  /** Último servicio (ISO); `null` si no tiene. */
  lastAt: string | null;
}

export interface ServiceRecordsSummary {
  count: number;
  total: number;
  /** Ticket promedio redondeado; `null` si no hay registros. */
  average: number | null;
  /** Último registro (ISO); `null` si no hay. */
  lastAt: string | null;
  /** Servicio más repetido; `null` si no hay o si hay empate (no se elige uno al azar). */
  topLabel: string | null;
}
