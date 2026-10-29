import { readFileSync } from 'node:fs';
import esbuild from 'esbuild';

/**
 * Compila la API para producción (Fase 3 de la auditoría): "node dist/server.js" liso, sin tsx (compilador JIT de
 * TypeScript) ni el código fuente crudo en la imagen final — ver Dockerfile, etapa "api-build".
 *
 * Las dependencias de npm reales quedan EXTERNAS (nunca agrupadas): sharp y @node-rs/argon2 traen binarios nativos
 * que esbuild no puede empaquetar, y da igual para las demás (siguen resolviéndose desde node_modules en runtime,
 * que la imagen ya copia). @xiro/shared es la única excepción: es un paquete del monorepo sin compilar (su "main"
 * en package.json apunta directo a src/index.ts), así que SÍ se agrupa dentro de cada bundle, igual que el resto
 * del código propio (apps/api/src) — si quedara externo, "node" intentaría importar un .ts y fallaría.
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((name) => name !== '@xiro/shared');

const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', external, logLevel: 'info' };

// __BUNDLED__: ver la nota en src/exports/pool.ts (decide si el hilo de exportaciones usa worker.js liso o
// worker.ts + tsx). migrate-cli.ts no la necesita: no genera worker_threads.
await esbuild.build({ ...common, entryPoints: ['src/server.ts'], outfile: 'dist/server.js', define: { __BUNDLED__: 'true' } });
await esbuild.build({ ...common, entryPoints: ['src/exports/worker.ts'], outfile: 'dist/worker.js', define: { __BUNDLED__: 'true' } });
await esbuild.build({ ...common, entryPoints: ['src/db/migrate-cli.ts'], outfile: 'dist/migrate-cli.js' });

console.log('apps/api compilado en dist/ (server.js, worker.js, migrate-cli.js).');
