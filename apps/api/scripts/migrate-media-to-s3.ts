/**
 * Copia las imágenes de la carpeta local (DATA_DIR/media) al almacén S3/R2 configurado.
 *
 *   npm run media:migrate -w @xiro/api -- --dry-run     (solo muestra qué haría)
 *   npm run media:migrate -w @xiro/api                  (copia)
 *
 * Requiere MEDIA_STORAGE=s3 y las variables S3_* (ver .env.example). Es idempotente: lo que ya está en el almacén se
 * salta, así que se puede volver a correr si se corta. No borra nada de la carpeta local: cuando la API ya sirve desde
 * R2 y todo se ve bien, la carpeta se puede archivar o borrar a mano. Los nombres en la base de datos no cambian
 * (siempre se guarda solo el nombre del archivo), así que no hay que tocar ninguna tabla.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config';
import { contentTypeOf, MEDIA_NAME, S3MediaStore } from '../src/storage';

const dryRun = process.argv.includes('--dry-run');
const config = loadConfig();
if (config.media.storage !== 's3') {
  console.error('Define MEDIA_STORAGE=s3 y las variables S3_* antes de migrar.');
  process.exit(1);
}
const store = new S3MediaStore(config.media);
const dir = config.mediaDir;

const names = (await readdir(dir).catch(() => [] as string[])).sort();
const valid = names.filter((name) => MEDIA_NAME.test(name));
const ignored = names.filter((name) => !MEDIA_NAME.test(name));
console.log(`Carpeta: ${dir}\nArchivos válidos: ${valid.length}${ignored.length ? ` · ignorados (nombre no generado por la API): ${ignored.length}` : ''}${dryRun ? '\n(modo prueba: no se sube nada)' : ''}`);

let uploaded = 0;
let skipped = 0;
const failed: string[] = [];
for (const [index, name] of valid.entries()) {
  try {
    if (await store.exists(name)) {
      skipped += 1;
      continue;
    }
    if (!dryRun) await store.put(name, await readFile(path.join(dir, name)), contentTypeOf(name));
    uploaded += 1;
  } catch (error) {
    failed.push(`${name}: ${(error as Error).message}`);
  }
  if ((index + 1) % 50 === 0) console.log(`  ${index + 1}/${valid.length}…`);
}

// Verificación: todo lo válido debe existir en el almacén (salvo en modo prueba).
const missing = dryRun ? [] : (await Promise.all(valid.map(async (name) => ((await store.exists(name)) ? null : name)))).filter((name): name is string => name !== null);

console.log(`\n${dryRun ? 'Se subirían' : 'Subidos'}: ${uploaded} · ya estaban: ${skipped} · fallidos: ${failed.length}${dryRun ? '' : ` · faltan tras verificar: ${missing.length}`}`);
for (const line of failed) console.error(`  ✗ ${line}`);
for (const name of missing) console.error(`  ✗ falta en el almacén: ${name}`);
process.exit(failed.length > 0 || missing.length > 0 ? 1 : 0);
