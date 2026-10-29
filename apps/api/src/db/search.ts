import { sql, type SQLWrapper } from 'drizzle-orm';

/**
 * Expresiones de búsqueda "contiene" (ILIKE '%…%'). Las usan a la vez los índices de trigramas (schema.ts) y las
 * consultas: PostgreSQL solo usa un índice de expresión si la consulta escribe EXACTAMENTE la misma expresión, por eso
 * viven en un solo lugar. Las constantes van literales (`sql.raw`), nunca como parámetros: son textos fijos del código.
 */
const ACCENTED = 'áàâäãéèêëíìîïóòôöõúùûüñç';
const PLAIN = 'aaaaaeeeeiiiiooooouuuunc';

/** Sin tildes ni mayúsculas (sin extensiones de PostgreSQL), igual que el `fold` que hacía la app sobre la lista. */
export const fold = (value: SQLWrapper) => sql`translate(lower(${value}), ${sql.raw(`'${ACCENTED}'`)}, ${sql.raw(`'${PLAIN}'`)})`;

/** Normaliza el texto que escribe la persona igual que `fold` normaliza la columna. */
export const foldQuery = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Nombre, correo y teléfono del cliente en un solo texto (índice clients_search_trgm_idx). Todo lo que contiene alguno
 * de los tres campos lo contiene también esta unión, así que filtrar por ella y además por cada campo devuelve
 * exactamente lo mismo que antes, pero con un solo índice en lugar de recorrer todos los clientes del negocio.
 */
export const clientSearchText = (name: SQLWrapper, email: SQLWrapper, phone: SQLWrapper) => sql`(${name} || ' ' || coalesce(${email}, '') || ' ' || coalesce(${phone}, ''))`;

/** Nombre y referencia del artículo, sin tildes (índice items_search_trgm_idx). Mismo razonamiento que el de clientes. */
export const itemSearchText = (name: SQLWrapper, referenceCode: SQLWrapper) => fold(sql`${name} || ' ' || ${referenceCode}`);
