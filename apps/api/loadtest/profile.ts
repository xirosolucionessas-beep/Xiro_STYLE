/**
 * Perfil de CPU de la API BAJO CARGA (para decidir qué optimizar con datos, no a ojo). Arranca la API con el inspector,
 * corre un escenario y graba el perfil por el protocolo de DevTools; imprime las funciones con más tiempo propio,
 * agrupadas por archivo, y guarda el .cpuprofile (ábrelo en Chrome DevTools → Performance).
 *
 *   npm run load:profile -w @xiro/api -- --scenario publica --duration 15
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LOAD_DIR, SEED_FILE, runScenario, startApi, type RequestSpec } from './lib';
import type { SeedData } from './seed';

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const SCENARIO = arg('scenario', 'publica');
const DURATION = Number(arg('duration', '15'));
const INSPECT_PORT = 9239;

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
}

async function devtools(): Promise<{ send: (method: string, params?: object) => Promise<any>; close: () => void }> {
  const [target] = (await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json()) as Array<{ webSocketDebuggerUrl: string }>;
  const ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  let id = 0;
  const pending = new Map<number, (value: unknown) => void>();
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
    if (message.id && pending.has(message.id)) pending.get(message.id)!(message.result);
  };
  return {
    send: (method, params = {}) =>
      new Promise((resolve) => {
        id += 1;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function main() {
  const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedData;
  const random = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
  // Un solo usuario del negocio grande: el perfil sube el límite por usuario (solo aquí; las mediciones usan los valores reales).
  const server = await startApi(`profile-${SCENARIO}`, { NODE_OPTIONS: `--inspect=127.0.0.1:${INSPECT_PORT}`, JWT_ACCESS_TTL: '1h', RATE_LIMIT_USER_PER_MIN: '100000' });
  try {
    const login = await fetch(`http://127.0.0.1:${process.env.LOADTEST_API_PORT ?? 3100}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.200.0.1' }, body: JSON.stringify({ identifier: seed.big.employeeEmails[0], password: seed.password }) });
    const token = ((await login.json()) as { accessToken: string }).accessToken;
    const next = (): RequestSpec => {
      if (SCENARIO === 'clientes') return { method: 'GET', path: '/api/clients', headers: { authorization: `Bearer ${token}` } };
      if (SCENARIO === 'catalogo') return { method: 'GET', path: '/api/items', headers: { authorization: `Bearer ${token}` } };
      const biz = random(seed.small);
      if (SCENARIO === 'disponibilidad') {
        const day = new Date(Date.now() + 86_400_000 * (1 + Math.floor(Math.random() * 20))).toISOString().slice(0, 10);
        return Math.random() < 0.5
          ? { method: 'GET', path: `/api/public/booking/${biz.slug}/availability?date=${day}&services=${biz.serviceId}` }
          : { method: 'GET', path: `/api/public/booking/${biz.slug}/days?from=${day}&days=14&services=${biz.serviceId}` };
      }
      return random<RequestSpec>([
        { method: 'GET', path: `/api/public/booking/${biz.slug}` },
        { method: 'GET', path: `/api/public/booking/${biz.slug}/catalog` },
        { method: 'GET', path: `/api/public/booking/${biz.slug}/team` },
      ]);
    };

    const cdp = await devtools();
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    const result = await runScenario(SCENARIO, { connections: 30, durationSeconds: DURATION, metricsToken: server.metricsToken, next });
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: { nodes: ProfileNode[]; startTime: number; endTime: number } };
    cdp.close();

    const file = path.join(LOAD_DIR, `perfil-${SCENARIO}.cpuprofile`);
    writeFileSync(file, JSON.stringify(profile));
    const total = profile.nodes.reduce((a, n) => a + (n.hitCount ?? 0), 0);
    const byFunction = new Map<string, number>();
    const byModule = new Map<string, number>();
    for (const node of profile.nodes) {
      const hits = node.hitCount ?? 0;
      if (!hits) continue;
      const { functionName, url, lineNumber } = node.callFrame;
      const where = url.replace(/^file:\/\/\/?/, '').replace(/.*node_modules[\\/]/, 'nm/').replace(/.*XIRO_STYLE_V2[\\/]/, '');
      const fn = `${functionName || '(anónima)'}  ${where}:${lineNumber + 1}`;
      byFunction.set(fn, (byFunction.get(fn) ?? 0) + hits);
      const module = where.startsWith('nm/') ? where.split(/[\\/]/).slice(0, where.startsWith('nm/@') ? 3 : 2).join('/') : where.startsWith('apps') ? where : functionName.startsWith('(') ? functionName : `node:${where || 'interno'}`;
      byModule.set(module, (byModule.get(module) ?? 0) + hits);
    }
    const top = (map: Map<string, number>, n: number) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`).join('\n');
    console.log(`\n${SCENARIO}: ${result.rps} req/s, p50 ${result.p50} ms, p95 ${result.p95} ms, ${JSON.stringify(result.statuses)}`);
    console.log(`\nTiempo propio por módulo:\n${top(byModule, 25)}`);
    console.log(`\nFunciones más costosas:\n${top(byFunction, 30)}`);
    console.log(`\nPerfil completo: ${file}`);
  } finally {
    await server.stop();
  }
}

await main();
