import { IMAGE_MATCH_SCORE, IMAGE_SIMILAR_SCORE, type Currency, type ImageMatchItem, type ImageMatchResult } from '@xiro/shared';
import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import type { Ctx } from '../context';
import { businesses, itemPhotos, items } from '../db/schema';
import { MAX_INPUT_PIXELS, sniffImage } from '../media';

/**
 * Comparar la foto de un producto con el inventario — LOCAL, sin IA ni servicio externo (decisión explícita del
 * negocio: la foto nunca sale de este servidor). Usa dos huellas baratas de calcular con `sharp` (ya una dependencia
 * del proyecto, sin modelo nuevo que descargar ni memoria extra que reservar):
 *  - `dHash` (hash de diferencia, 64 bits): captura la FORMA/estructura de la imagen, tolerante a cambios de brillo
 *    y a volver a comprimirla.
 *  - Histograma de color (64 cubos): ayuda a distinguir productos con la misma silueta pero de otro color.
 * Esto reconoce la MISMA foto (o una muy parecida: mismo ángulo/fondo) tomada de nuevo o recomprimida — no es
 * reconocimiento semántico de objetos (no "sabe" que dos fotos muy distintas son el mismo producto). Se documenta
 * así para no prometer más precisión de la que da.
 */

export interface ImageFingerprint {
  hash: bigint;
  histogram: Float64Array;
}

/** Igual chequeo de "imagen real" que las fotos de catálogo (`saveImage`/`sniffImage` en media.ts): nunca se confía
 * en la extensión ni el Content-Type que manda el cliente. Exportada para probarla directamente (ver test). */
export async function fingerprintImage(buffer: Buffer): Promise<ImageFingerprint | null> {
  if (!sniffImage(buffer)) return null;
  try {
    const base = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const [gray, color] = await Promise.all([
      base.clone().resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer(),
      base.clone().resize(32, 32, { fit: 'fill' }).raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true }),
    ]);
    let hash = 0n;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = gray[row * 9 + col]!;
        const right = gray[row * 9 + col + 1]!;
        hash = (hash << 1n) | (left < right ? 1n : 0n);
      }
    }
    const channels = color.info.channels; // 3 (rgb) o 4 (rgba, según el formato de origen)
    const histogram = new Float64Array(64);
    let total = 0;
    for (let i = 0; i < color.data.length; i += channels) {
      const bucket = (color.data[i]! >> 6) * 16 + (color.data[i + 1]! >> 6) * 4 + (color.data[i + 2]! >> 6);
      histogram[bucket]! += 1;
      total += 1;
    }
    if (total > 0) for (let i = 0; i < histogram.length; i++) histogram[i]! /= total;
    return { hash, histogram };
  } catch {
    return null;
  }
}

function popcount64(value: bigint): number {
  let count = 0;
  let v = value;
  while (v > 0n) {
    count += Number(v & 1n);
    v >>= 1n;
  }
  return count;
}

const HASH_WEIGHT = 0.65;
const HISTOGRAM_WEIGHT = 0.35;

/** 0–100: qué tan parecidas son dos huellas. 100 = misma foto (o una recompresión suya); 0 = completamente distintas.
 * Exportada para probarla directamente (ver test). */
export function imageSimilarity(a: ImageFingerprint, b: ImageFingerprint): number {
  const hashSimilarity = 1 - popcount64(a.hash ^ b.hash) / 64;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff += Math.abs(a.histogram[i]! - b.histogram[i]!);
  const histogramSimilarity = 1 - diff / 2; // la distancia de variación total cae en [0,2]
  return Math.round((hashSimilarity * HASH_WEIGHT + histogramSimilarity * HISTOGRAM_WEIGHT) * 100);
}

const stockStatusOf = (status: string): 'available' | 'reorder' | 'out_of_stock' => (status === 'reorder' || status === 'out_of_stock' ? status : 'available');

/**
 * Compara `queryBuffer` contra las fotos de los PRODUCTOS (nunca servicios: solo ellos tienen existencias) del
 * inventario de `businessId`. Nunca inventa un producto: si no hay fotos en el inventario, o ninguna foto se parece
 * lo bastante, lo dice. Los datos de cada resultado (precio, existencias) se leen de `items` en el momento de
 * preguntar — nunca de una caché vieja.
 */
export async function matchProductImage(ctx: Pick<Ctx, 'db' | 'media'>, businessId: string, queryBuffer: Buffer): Promise<ImageMatchResult> {
  const { db, media } = ctx;
  const query = await fingerprintImage(queryBuffer);
  if (!query) return { ok: false, reason: 'invalid_image' };

  const rows = await db
    .select({ itemId: itemPhotos.itemId, file: itemPhotos.file })
    .from(itemPhotos)
    .innerJoin(items, and(eq(items.id, itemPhotos.itemId), eq(items.businessId, businessId), eq(items.kind, 'product')));
  if (rows.length === 0) return { ok: false, reason: 'no_inventory' };

  const bestScoreByItem = new Map<string, number>();
  const CONCURRENCY = 4;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + CONCURRENCY).map(async (row) => {
        const stored = await media.get(row.file);
        if (!stored) return;
        const candidate = await fingerprintImage(stored.body);
        if (!candidate) return;
        const score = imageSimilarity(query, candidate);
        if (score > (bestScoreByItem.get(row.itemId) ?? -1)) bestScoreByItem.set(row.itemId, score);
      }),
    );
  }
  if (bestScoreByItem.size === 0) return { ok: true, kind: 'none' };

  const ranked = [...bestScoreByItem.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0]![1];
  if (best < IMAGE_SIMILAR_SCORE) return { ok: true, kind: 'none' };

  const kind: 'match' | 'similar' = best >= IMAGE_MATCH_SCORE ? 'match' : 'similar';
  const threshold = kind === 'match' ? IMAGE_MATCH_SCORE : IMAGE_SIMILAR_SCORE;
  const topIds = ranked.filter(([, score]) => score >= threshold).slice(0, 3);
  const itemRows = await db
    .select({ id: items.id, name: items.name, price: items.price, stock: items.stock, stockStatus: items.stockStatus })
    .from(items)
    .where(and(eq(items.businessId, businessId), inArray(items.id, topIds.map(([id]) => id))));
  const scoreOf = new Map(topIds);
  const resultItems: ImageMatchItem[] = itemRows
    .map((row) => ({ id: row.id, name: row.name, price: row.price, stock: row.stock, stockStatus: stockStatusOf(row.stockStatus), score: scoreOf.get(row.id)! }))
    .sort((a, b) => b.score - a.score);
  const [business] = await db.select({ currency: businesses.currency }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return { ok: true, kind, currency: (business?.currency ?? 'COP') as Currency, items: resultItems };
}
