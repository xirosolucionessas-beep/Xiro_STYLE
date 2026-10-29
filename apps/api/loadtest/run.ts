/**
 * Pruebas de carga (Fase 5) contra la API real con los datos de `load:seed`.
 *
 *   npm run load:run -w @xiro/api -- --label antes
 *   npm run load:run -w @xiro/api -- --label despues --only clientes,mixto --duration 30 --steps 10,50,100
 *
 * Escenarios (bucle cerrado: cada usuario virtual pide sin pausa, mide el máximo sostenible):
 *   login       POST /api/auth/login con cuentas distintas (argon2id: costoso a propósito)
 *   clientes    lista paginada (primera página y siguientes por cursor) + búsqueda, negocio con 20.000 clientes
 *   catalogo    lista paginada + búsqueda, negocio con 5.000 artículos
 *   publica     lo que pide la página /reservar al abrirse: perfil, catálogo, equipo, reseñas, días y horarios
 *   citas       crear reserva pública (409 = otro tomó ese horario: respuesta correcta, no error)
 *   mixto       todo junto (lectura y escritura) en escalones de usuarios concurrentes: dónde empieza a degradarse
 *
 * Resultados: data/carga/resultados-<label>.json y una tabla en consola. Límites de abuso ACTIVOS como en producción.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AuthSession, Page } from '@xiro/shared';
import { addDays, localDate, weekdayOf, zonedInstant } from '../src/booking/time';
import { LOAD_DIR, SEED_FILE, api, parallel, runScenario, sleep, startApi, type RequestSpec, type ScenarioResult } from './lib';
import type { SeedData } from './seed';

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const LABEL = arg('label', 'prueba');
const DURATION = Number(arg('duration', '20'));
const ONLY = arg('only', 'login,clientes,catalogo,publica,citas,mixto').split(',');
const STEPS = arg('steps', '10,50,100,200').split(',').map(Number);
const CONNECTIONS = Number(arg('connections', '50'));
const TZ = 'America/Bogota';

const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedData;
const random = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

/** Días hábiles (lunes a sábado, horario por defecto) desde mañana, hora de Bogotá. */
const workdays = (count: number) => {
  const days: string[] = [];
  let date = localDate(new Date(), TZ);
  while (days.length < count) {
    date = addDays(date, 1);
    if (weekdayOf(date) !== 0) days.push(date);
  }
  return days;
};

async function main() {
  const server = await startApi(LABEL, { JWT_ACCESS_TTL: '1h', ...(process.env.LOADTEST_API_ENV ? JSON.parse(process.env.LOADTEST_API_ENV) : {}) });
  const results: ScenarioResult[] = [];
  const log = (r: ScenarioResult) => {
    results.push(r);
    console.log(`  ${r.name.padEnd(22)} ${String(r.rps).padStart(7)} req/s  p50 ${r.p50} ms  p95 ${r.p95} ms  p99 ${r.p99} ms  errores ${r.errorRatePct}%  ${JSON.stringify(r.statuses)}`);
  };

  try {
    /* ----- Sesiones: el dueño y los empleados del negocio grande (cada uno con su límite por usuario) ----- */
    console.log('Iniciando sesiones de prueba…');
    const bigSessions: AuthSession[] = [];
    await parallel([seed.big.ownerEmail, ...seed.big.employeeEmails], 4, async (email) => {
      bigSessions.push(await api<AuthSession>('POST', '/api/auth/login', { identifier: email, password: seed.password }));
    });
    const bearer = () => ({ authorization: `Bearer ${random(bigSessions).accessToken}` });

    // Cursores reales de las primeras 40 páginas: los usuarios virtuales navegan como en la app (siguiente página).
    const cursors = async (url: string) => {
      const list: Array<string | null> = [null];
      let cursor: string | null = null;
      for (let i = 0; i < 40; i += 1) {
        const page: Page<unknown> = await api<Page<unknown>>('GET', `${url}${cursor ? `${url.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, bigSessions[0]!.accessToken);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        list.push(cursor);
      }
      return list;
    };
    const clientCursors = await cursors('/api/clients');
    const itemCursors = await cursors('/api/items');
    const withCursor = (url: string, cursor: string | null) => (cursor ? `${url}?cursor=${encodeURIComponent(cursor)}` : url);

    const clientSearches = ['mar', 'gómez', 'ana rod', 'lau', 'santiago', 'herrera ospina', '310000', 'valen', 'díaz', 'cliente12'];
    const itemSearches = ['shampoo', 'cera mate', 'keratina', 'REF-00', 'corte', 'serum', 'tinte', 'pomada', 'bálsamo', 'spray'];
    const clientsReq = (): RequestSpec =>
      Math.random() < 0.25
        ? { method: 'GET', path: `/api/clients?q=${encodeURIComponent(random(clientSearches))}`, headers: bearer() }
        : { method: 'GET', path: withCursor('/api/clients', random(clientCursors)), headers: bearer() };
    const itemsReq = (): RequestSpec =>
      Math.random() < 0.25
        ? { method: 'GET', path: `/api/items?q=${encodeURIComponent(random(itemSearches))}`, headers: bearer() }
        : { method: 'GET', path: withCursor('/api/items', random(itemCursors)), headers: bearer() };

    const days = workdays(28);
    const publicReq = (): RequestSpec => {
      const biz = random(seed.small);
      const base = `/api/public/booking/${biz.slug}`;
      const r = Math.random();
      if (r < 0.2) return { method: 'GET', path: base };
      if (r < 0.4) return { method: 'GET', path: `${base}/catalog` };
      if (r < 0.5) return { method: 'GET', path: `${base}/team` };
      if (r < 0.6) return { method: 'GET', path: `${base}/reviews` };
      if (r < 0.75) return { method: 'GET', path: `${base}/days?from=${days[0]}&days=14&services=${biz.serviceId}` };
      return { method: 'GET', path: `${base}/availability?date=${random(days)}&services=${biz.serviceId}` };
    };
    let phone = Math.floor(Math.random() * 10_000_000);
    const bookingReq = (): RequestSpec => {
      const biz = random(seed.small);
      const minutes = 9 * 60 + 30 * Math.floor(Math.random() * 20); // 09:00 a 18:30
      phone += 1;
      return {
        method: 'POST',
        path: `/api/public/booking/${biz.slug}/appointments`,
        body: {
          selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [] },
          professionalId: 'any',
          startsAt: zonedInstant(random(days), minutes, TZ).toISOString(),
          customer: { firstName: 'Carga', lastName: 'Prueba', email: '', phone: `31${String(phone % 100_000_000).padStart(8, '0')}`, notes: '', custom: {} },
          acceptTerms: true,
          remindersOptIn: false,
          website: '',
        },
      };
    };
    const loginAccounts = [...seed.small.map((s) => s.email), ...seed.big.employeeEmails];
    const loginReq = (): RequestSpec => ({ method: 'POST', path: '/api/auth/login', body: { identifier: random(loginAccounts), password: seed.password } });
    let created = 0;
    const createClientReq = (): RequestSpec => ({ method: 'POST', path: '/api/clients', headers: bearer(), body: { name: `Cliente nuevo ${LABEL} ${(created += 1)}`, phone: `32${String((Date.now() + created) % 100_000_000).padStart(8, '0')}` } });

    const common = { durationSeconds: DURATION, metricsToken: server.metricsToken };
    console.log(`\nEscenarios (${DURATION} s cada uno):`);
    if (ONLY.includes('login')) log(await runScenario('login', { ...common, connections: 20, next: loginReq }));
    if (ONLY.includes('clientes')) log(await runScenario('clientes (20k)', { ...common, connections: CONNECTIONS, next: clientsReq }));
    if (ONLY.includes('catalogo')) log(await runScenario('catalogo (5k)', { ...common, connections: CONNECTIONS, next: itemsReq }));
    if (ONLY.includes('publica')) log(await runScenario('pagina publica', { ...common, connections: CONNECTIONS, next: publicReq }));
    // Un solo negocio muy visitado (p. ej. comparte su enlace en redes): mide el límite por negocio, no el servidor.
    if (ONLY.includes('viral')) {
      const viral = seed.small[5]!;
      log(await runScenario('negocio viral (1 slug)', { ...common, connections: 20, next: () => {
        const spec = publicReq();
        return { ...spec, path: spec.path.replace(/\/api\/public\/booking\/[^/?]+/, `/api/public/booking/${viral.slug}`).replace(/services=[^&]+/, `services=${viral.serviceId}`) };
      } }));
    }
    if (ONLY.includes('citas')) log(await runScenario('crear cita publica', { ...common, connections: 20, next: bookingReq, okStatuses: [409] }));
    if (ONLY.includes('mixto')) {
      // Proporción aproximada de un día normal: mucha lectura, poca escritura.
      const mixed = (): RequestSpec => {
        const r = Math.random();
        if (r < 0.3) return publicReq();
        if (r < 0.55) return clientsReq();
        if (r < 0.75) return itemsReq();
        if (r < 0.85) return { method: 'GET', path: '/api/clients/summary', headers: bearer() };
        if (r < 0.92) return createClientReq();
        if (r < 0.98) return bookingReq();
        return loginReq();
      };
      for (const connections of STEPS) {
        await sleep(3000);
        log(await runScenario(`mixto x${connections}`, { ...common, connections, next: mixed, okStatuses: [409] }));
      }
    }
  } finally {
    await server.stop();
  }

  const file = path.join(LOAD_DIR, `resultados-${LABEL}.json`);
  writeFileSync(file, JSON.stringify({ label: LABEL, at: new Date().toISOString(), durationSeconds: DURATION, results }, null, 2));
  console.log(`\n| Escenario | Usuarios | req/s | P50 ms | P95 ms | P99 ms | Errores | CPU API (prom/máx) | CPU equipo | RAM API máx | Pool máx / en espera |`);
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const x = r.resources;
    console.log(`| ${r.name} | ${r.connections} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.errorRatePct}% | ${x.apiCpuAvgPct}% / ${x.apiCpuMaxPct}% | ${x.machineCpuAvgPct}% | ${x.apiRssMaxMb} MB | ${x.poolMax} / ${x.poolWaitingMax} |`);
  }
  console.log(`\nGuardado en ${file}`);
}

await main();
