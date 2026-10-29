import type { Page } from '@xiro/shared';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { AppError } from './errors';

/**
 * Cursor opaco de los listados: los valores de la última fila de la página (clave de orden + id), en JSON base64url.
 * Las fechas viajan como el texto exacto que devuelve PostgreSQL (`timestamptz::text`, con microsegundos): un `Date` de
 * JavaScript solo guarda milisegundos y la comparación de la página siguiente saltaría o repetiría filas.
 */
export type CursorValue = string | number;

export function encodeCursor(values: readonly CursorValue[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

/** Decodifica y valida la forma (`kinds`: tipo de cada posición). Un cursor alterado o de otro listado es un 400, nunca un 500. */
export function decodeCursor(cursor: string | undefined, kinds: ReadonlyArray<'string' | 'number'>): CursorValue[] | null {
  if (!cursor) return null;
  try {
    const values: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(values) && values.length === kinds.length && values.every((value, index) => typeof value === kinds[index] && (typeof value !== 'string' || value.length <= 300))) return values as CursorValue[];
  } catch {
    // cae al error de abajo
  }
  throw new AppError(400, 'validation_error', 'Invalid cursor');
}

/**
 * Arma la página a partir de `limit + 1` filas: si sobra una, hay página siguiente y el cursor sale de la última
 * fila mostrada (`keyOf`).
 */
export function toPage<Row, T>(rows: readonly Row[], limit: number, keyOf: (row: Row) => readonly CursorValue[], map: (row: Row) => T): Page<T> {
  const visible = rows.slice(0, limit);
  const last = visible[visible.length - 1];
  return { data: visible.map(map), nextCursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null };
}

/**
 * "Más reciente primero" escrito como DESC NULLS LAST. Los índices de fecha existentes (ventas, registros de servicio,
 * artículos, reseñas) se crearon DESC NULLS LAST, y un ORDER BY ... DESC a secas significa NULLS FIRST en PostgreSQL:
 * no coincidían y el índice no servía para ordenar. Las columnas son NOT NULL, así que el resultado es idéntico.
 */
export const descNullsLast = (column: SQLWrapper) => sql`${column} desc nulls last`;

/** Escapa los comodines de LIKE/ILIKE para que la búsqueda sea literal ("%" o "_" no coinciden con todo). */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);
