import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isTranslationKey } from '@xiro/shared';
import { describe, expect, it } from 'vitest';

/**
 * Android/iOS traducen SOLO con el diccionario compartido (`useSettings().t` → `@xiro/shared`); los textos de `src/web`
 * no llegan al teléfono. Si una pantalla nativa usa una clave que solo existe en la web, en el teléfono se ve la clave en
 * bruto ("sale_new_title"). Esta prueba recorre el código nativo y exige que cada `t('clave')` literal exista en el diccionario compartido.
 */
const SRC = path.resolve(__dirname, '../src');

function nativeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return full === path.join(SRC, 'web') ? [] : nativeFiles(full);
    return /\.tsx?$/.test(name) && !/\.web\.tsx?$/.test(name) ? [full] : [];
  });
}

const usages = nativeFiles(SRC).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-z][a-z0-9_]*)'/g)].map((match) => ({ key: match[1]!, file: path.relative(SRC, file) })),
);

describe('textos de las pantallas nativas', () => {
  it('encuentra usos que revisar (la búsqueda no está rota)', () => {
    expect(usages.length).toBeGreaterThan(500);
  });

  // EN tiene por tipo las mismas claves que ES (Record<TranslationKey, string>): basta con que exista la clave.
  it('cada clave literal existe en el diccionario compartido', () => {
    const missing = usages.filter(({ key }) => !isTranslationKey(key));
    expect(missing.map(({ key, file }) => `${key} (${file})`)).toEqual([]);
  });
});
