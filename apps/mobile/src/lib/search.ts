/** Minúsculas sin acentos: "manicure" encuentra "Manicüre", "jose" encuentra "José". */
export const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export interface SearchableItem {
  id: string;
  name: string;
  categoryName: string;
  price: number;
}

/** Servicios y productos cuyo nombre o categoría contiene la consulta; primero los que EMPIEZAN por ella. */
export function searchItems<T extends SearchableItem>(items: readonly T[], query: string, limit = 5): T[] {
  const q = fold(query);
  if (q.length === 0) return [];
  const scored: Array<{ item: T; rank: number }> = [];
  for (const item of items) {
    const name = fold(item.name);
    const category = fold(item.categoryName);
    if (name.startsWith(q)) scored.push({ item, rank: 0 });
    else if (name.includes(q)) scored.push({ item, rank: 1 });
    else if (category.includes(q)) scored.push({ item, rank: 2 });
  }
  return scored.sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name)).slice(0, limit).map((entry) => entry.item);
}

/** Búsqueda de una sola letra es ruido: se exige al menos 2 caracteres para consultar al servidor. */
export const MIN_QUERY_LENGTH = 2;
export const isSearchable = (query: string): boolean => fold(query).length >= MIN_QUERY_LENGTH;
