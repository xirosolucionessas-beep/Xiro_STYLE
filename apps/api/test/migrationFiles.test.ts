import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Las migraciones (y sus reversiones) deben poder aplicarse en CUALQUIER base: la de las pruebas y algunas de producción
 * no usan UTF-8, y un carácter que su codificación no representa hace fallar la migración COMPLETA (error 22P05), aunque
 * esté en un comentario. Pasó el 2026-10-14 con una flecha "→" en 0036: la API de desarrollo no arrancó hasta corregirla.
 * Regla: solo caracteres que existen en Windows-1252, la codificación de la base de pruebas en Windows (Latin-1 más
 * “ ” ‘ ’ – — … € y pocos más). Tildes, ñ, ¿ y ¡ sí; flechas (→), símbolos matemáticos y emojis no.
 */
// Los 27 caracteres que Windows-1252 agrega en 0x80–0x9F sobre Latin-1.
const CP1252_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
const encodable = (char: string) => char.codePointAt(0)! <= 0xff || CP1252_EXTRA.has(char);
const dirs = [path.join(__dirname, '../drizzle'), path.join(__dirname, '../drizzle/rollback')];

describe('archivos de migración', () => {
  it('solo usan caracteres de Windows-1252 (aplicables en la base de pruebas y en UTF-8)', () => {
    const offending: string[] = [];
    for (const dir of dirs) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
        readFileSync(path.join(dir, file), 'utf8')
          .split('\n')
          .forEach((line, index) => {
            const bad = [...line].find((char) => !encodable(char));
            if (bad) offending.push(`${path.basename(dir)}/${file}:${index + 1} → "${bad}" (U+${bad.codePointAt(0)!.toString(16).toUpperCase()})`);
          });
      }
    }
    expect(offending).toEqual([]);
  });

  it('cada migración aditiva reciente tiene su script de reversión', () => {
    const migrations = readdirSync(dirs[0]!).filter((f) => /^\d{4}_.+\.sql$/.test(f));
    const rollbacks = new Set(readdirSync(dirs[1]!));
    // Desde 0024 cada migración trae su reversión manual (ver docs/deploy.md §4).
    const missing = migrations.filter((f) => Number(f.slice(0, 4)) >= 24 && !rollbacks.has(f.replace(/\.sql$/, '.down.sql')));
    expect(missing).toEqual([]);
  });
});
