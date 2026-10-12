/**
 * Pruebas de seguridad automatizadas BAJO ATAQUE contra la API real (Fase 5). Las pruebas unitarias (test/security*,
 * test/rateLimits*) verifican cada defensa por separado; aquí se comprueba que, con volumen de ataque real, las defensas
 * frenan al atacante Y los usuarios legítimos siguen atendidos. Sale con código 1 si algo falla.
 *
 *   npm run load:security -w @xiro/api   (requiere `npm run load:db` y `npm run load:seed`)
 */
import { readFileSync } from 'node:fs';
import type { AuthSession } from '@xiro/shared';
import { BASE, SEED_FILE, api, runScenario, startApi, type ScenarioResult } from './lib';
import type { SeedData } from './seed';

const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedData;
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${name} — ${detail}`);
};
const share = (r: ScenarioResult, status: number) => (100 * (r.statuses[status] ?? 0)) / Math.max(1, r.requests);
const pct = (n: number) => `${n.toFixed(1)} %`;

/** Mide a un usuario legítimo (otra IP, otra cuenta) mientras corre un ataque. */
async function legitimateDuring<T>(attack: Promise<T>, request: () => Promise<Response>): Promise<{ attack: T; statuses: number[]; p95: number }> {
  const statuses: number[] = [];
  const times: number[] = [];
  let running = true;
  const probe = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500)); // el ataque ya está en marcha
    while (running) {
      const started = performance.now();
      const res = await request();
      await res.arrayBuffer();
      times.push(performance.now() - started);
      statuses.push(res.status);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })();
  const result = await attack;
  running = false;
  await probe;
  times.sort((a, b) => a - b);
  return { attack: result, statuses, p95: times[Math.ceil(times.length * 0.95) - 1] ?? 0 };
}

async function main() {
  const server = await startApi('security');
  const common = { durationSeconds: 10, metricsToken: server.metricsToken };
  try {
    const victim = seed.small[0]!.email;
    const legit = await api<AuthSession>('POST', '/api/auth/login', { identifier: seed.big.employeeEmails[0], password: seed.password });
    const legitClients = () => fetch(`${BASE}/api/clients`, { headers: { authorization: `Bearer ${legit.accessToken}`, 'x-forwarded-for': '10.250.0.1' } });

    console.log('\n1. Fuerza bruta de contraseñas desde UNA IP (20 conexiones, 10 s)');
    const brute = await legitimateDuring(
      runScenario('fuerza bruta 1 IP', { ...common, connections: 20, next: () => ({ method: 'POST', path: '/api/auth/login', headers: { 'x-forwarded-for': '203.0.113.7' }, body: { identifier: victim, password: 'adivinanza-123' } }) }),
      legitClients,
    );
    check('el atacante recibe 429 casi siempre', share(brute.attack, 429) >= 99, `${pct(share(brute.attack, 429))} de ${brute.attack.requests} intentos con 429; 401 (contraseña probada): ${brute.attack.statuses[401] ?? 0}`);
    check('el atacante prueba como mucho 10 contraseñas por minuto', (brute.attack.statuses[401] ?? 0) <= 10, `${brute.attack.statuses[401] ?? 0} contraseñas evaluadas`);
    check('un usuario legítimo sigue atendido durante el ataque', brute.statuses.length > 0 && brute.statuses.every((s) => s === 200), `${brute.statuses.length} peticiones, códigos ${[...new Set(brute.statuses)].join(',')}, p95 ${brute.p95.toFixed(0)} ms`);

    console.log('\n2. Relleno de credenciales DISTRIBUIDO contra una cuenta (cada intento desde otra IP)');
    const target = seed.small[1]!.email;
    const stuffing = await runScenario('relleno distribuido', { ...common, connections: 10, next: () => ({ method: 'POST', path: '/api/auth/login', body: { identifier: target, password: 'otra-clave-999' } }) });
    check('la cuenta se bloquea tras 10 fallos aunque cambie la IP', (stuffing.statuses[401] ?? 0) <= 10 && share(stuffing, 429) >= 95, `${stuffing.statuses[401] ?? 0} contraseñas evaluadas, ${pct(share(stuffing, 429))} con 429`);
    const owner = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.250.0.2' }, body: JSON.stringify({ identifier: seed.small[2]!.email, password: seed.password }) });
    check('las demás cuentas inician sesión normalmente', owner.status === 200, `login de otra cuenta: ${owner.status}`);

    console.log('\n3. Spam de reservas desde UNA IP');
    const biz = seed.small[3]!;
    const day = new Date(Date.now() + 86_400_000 * 45).toISOString().slice(0, 10);
    let n = 0;
    const spam = await runScenario('spam de reservas', {
      ...common,
      connections: 5,
      okStatuses: [409],
      next: () => ({
        method: 'POST',
        path: `/api/public/booking/${biz.slug}/appointments`,
        headers: { 'x-forwarded-for': '198.51.100.9' },
        body: { selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [] }, professionalId: 'any', startsAt: `${day}T${String(14 + (n++ % 9)).padStart(2, '0')}:00:00.000Z`, customer: { firstName: 'Bot', lastName: 'Spam', email: '', phone: `3200${String(n).padStart(6, '0')}`, notes: '', custom: {} }, acceptTerms: true, remindersOptIn: false, website: '' },
      }),
    });
    const created = (spam.statuses[201] ?? 0) + (spam.statuses[409] ?? 0) + (spam.statuses[400] ?? 0);
    check('una IP no puede crear más de 20 reservas por hora', created <= 20 && share(spam, 429) >= 95, `${spam.statuses[201] ?? 0} creadas, ${pct(share(spam, 429))} con 429`);

    console.log('\n4. Inundación de tokens falsos (sesión forjada) contra rutas privadas');
    const forged = await legitimateDuring(
      runScenario('tokens falsos', { ...common, connections: 30, next: () => ({ method: 'GET', path: '/api/clients', headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma-falsa' } }) }),
      legitClients,
    );
    const rejected = (forged.attack.statuses[401] ?? 0) + (forged.attack.statuses[429] ?? 0);
    check('ningún token falso obtiene datos', (forged.attack.statuses[200] ?? 0) === 0 && rejected === forged.attack.requests, `${forged.attack.requests} peticiones: ${JSON.stringify(forged.attack.statuses)}`);
    check('el usuario legítimo sigue atendido', forged.statuses.length > 0 && forged.statuses.every((s) => s === 200), `${forged.statuses.length} peticiones, p95 ${forged.p95.toFixed(0)} ms`);

    console.log('\n5. Cuerpos gigantes y malformados');
    const big = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.250.0.3' }, body: JSON.stringify({ identifier: 'x@y.co', password: 'a'.repeat(3_000_000) }) });
    check('un cuerpo de 3 MB se rechaza sin procesarlo', big.status === 413, `código ${big.status}`);
    const nested = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.250.0.4' }, body: `${'['.repeat(50_000)}${']'.repeat(50_000)}` });
    check('JSON anidado 50.000 niveles no tumba el proceso', nested.status === 400 && (await fetch(`${BASE}/api/health`)).status === 200, `código ${nested.status}, servidor vivo`);
    const broken = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.250.0.5' }, body: '{"identifier": ' });
    check('JSON roto responde 400 sin detalles internos', broken.status === 400 && !/stack|at \w+ \(|node_modules/.test(await broken.text()), `código ${broken.status}`);

    console.log('\n6. Cabeceras de seguridad en el proceso real');
    const page = await fetch(`${BASE}/api/public/booking/${seed.small[4]!.slug}`, { headers: { 'x-forwarded-for': '10.250.0.6' } });
    const h = page.headers;
    check('nosniff, anti-clickjacking, CSP y sin X-Powered-By', h.get('x-content-type-options') === 'nosniff' && !!h.get('content-security-policy') && /deny|sameorigin/i.test(h.get('x-frame-options') ?? '') && !h.get('x-powered-by'), `CSP ${h.get('content-security-policy') ? 'sí' : 'no'}, XFO ${h.get('x-frame-options')}`);
    check('cada respuesta trae X-Request-Id para rastrear incidentes', /^[A-Za-z0-9._:-]{8,128}$/.test(h.get('x-request-id') ?? ''), h.get('x-request-id') ?? 'sin id');
    const health = await fetch(`${BASE}/api/health/ready`);
    check('tras todos los ataques el servidor sigue listo', health.status === 200, `readiness ${health.status}`);
  } finally {
    await server.stop();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} comprobaciones superadas.`);
  if (failed.length) process.exitCode = 1;
}

await main();
