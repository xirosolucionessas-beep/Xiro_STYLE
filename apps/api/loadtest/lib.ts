/**
 * Utilidades de las pruebas de carga (Fase 5). Todo corre contra una base DEDICADA (`xiro_carga`), nunca la de desarrollo,
 * y contra la API real arrancada como proceso aparte (igual que en producción: `node --import tsx src/server.ts`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import pg from 'pg';

export const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Datos de la carga (base embebida, siembra, resultados): dentro de apps/api/data, que git ignora. */
export const LOAD_DIR = path.join(API_DIR, 'data', 'carga');
export const SEED_FILE = path.join(LOAD_DIR, 'seed.json');
export const PG_PORT = Number(process.env.LOADTEST_PG_PORT ?? 54330);
export const ADMIN_URL = process.env.LOADTEST_ADMIN_URL ?? `postgres://xiro:xiro@127.0.0.1:${PG_PORT}/postgres`;
export const DB_NAME = 'xiro_carga';
export const API_PORT = Number(process.env.LOADTEST_API_PORT ?? 3100);
export const BASE = `http://127.0.0.1:${API_PORT}`;

export const databaseUrl = () => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB_NAME}`;
  return url.toString();
};

export async function ensureDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [DB_NAME]);
  if (!rowCount) await admin.query(`create database ${DB_NAME}`);
  await admin.end();
}

/* ---------- La API bajo prueba ---------- */

export interface ApiProcess {
  child: ChildProcess;
  metricsToken: string;
  stop: () => Promise<void>;
}

/**
 * Arranca la API como en producción salvo lo que esta máquina no tiene (Redis, R2, proveedor de OTP): modo development,
 * logs JSON a archivo (mismo costo que en producción), límites de abuso ACTIVOS (salvo que se pida lo contrario) y
 * TRUST_PROXY=1 para que cada usuario virtual llegue con su propia IP (X-Forwarded-For), como detrás de un balanceador.
 */
export async function startApi(label: string, env: Record<string, string> = {}): Promise<ApiProcess> {
  mkdirSync(LOAD_DIR, { recursive: true });
  const metricsToken = randomBytes(24).toString('hex');
  const log = createWriteStream(path.join(LOAD_DIR, `api-${label}.log`));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: API_DIR,
    env: {
      PATH: process.env.PATH ?? '',
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(API_PORT),
      DATABASE_URL: databaseUrl(),
      DATA_DIR: path.join(LOAD_DIR, 'api-data'),
      JWT_SECRET: randomBytes(32).toString('hex'),
      METRICS_TOKEN: metricsToken,
      TRUST_PROXY: '1',
      LOG_LEVEL: 'info',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  let exited = false;
  child.once('exit', () => (exited = true));

  const deadline = Date.now() + 90_000;
  for (;;) {
    if (exited) throw new Error(`La API terminó al arrancar: revisa ${path.join(LOAD_DIR, `api-${label}.log`)}`);
    try {
      const res = await fetch(`${BASE}/api/health/ready`);
      if (res.ok) break;
    } catch {
      // aún no escucha
    }
    if (Date.now() > deadline) throw new Error('La API no quedó lista en 90 s');
    await sleep(500);
  }
  return {
    child,
    metricsToken,
    stop: () =>
      new Promise((resolve) => {
        if (exited) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- HTTP de apoyo (siembra y preparación) ---------- */

let ipCounter = 0;
/** Una IP distinta por usuario virtual (10.x.y.z): los límites por IP actúan como con usuarios reales. */
export const nextIp = () => {
  ipCounter = (ipCounter + 1) % 16_000_000;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

export async function api<T>(method: string, url: string, body?: unknown, token?: string, expected: number[] = [200, 201]): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'x-forwarded-for': nextIp(), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!expected.includes(res.status)) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Ejecuta `tasks` con un máximo de `concurrency` a la vez. */
export async function parallel<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await task(items[index]!, index);
      }
    }),
  );
}

/* ---------- Muestreo de recursos ---------- */

export interface ResourceSummary {
  apiCpuAvgPct: number;
  apiCpuMaxPct: number;
  machineCpuAvgPct: number;
  apiRssMaxMb: number;
  heapMaxMb: number;
  eventLoopP99MaxMs: number;
  poolMax: number;
  poolWaitingMax: number;
}

const readMetric = (text: string, name: string) => {
  const line = text.split('\n').find((l) => l.startsWith(`${name} `));
  return line ? Number(line.slice(name.length + 1)) : 0;
};

const machineCpu = () => os.cpus().reduce((acc, cpu) => ({ idle: acc.idle + cpu.times.idle, total: acc.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });

/** Lee /api/metrics cada segundo durante la prueba: CPU y memoria de la API, demora del event loop y pool de PostgreSQL. */
export function sampleResources(metricsToken: string): { stop: () => Promise<ResourceSummary> } {
  const samples: Array<{ cpu: number; rss: number; heap: number; loop: number; pool: number; waiting: number; machine: number }> = [];
  let last: { at: number; cpu: number } | null = null;
  let lastMachine = machineCpu();
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        const text = await (await fetch(`${BASE}/api/metrics`, { headers: { authorization: `Bearer ${metricsToken}` } })).text();
        const at = performance.now();
        const cpu = readMetric(text, 'xiro_process_cpu_seconds_total');
        const machine = machineCpu();
        const machinePct = 100 * (1 - (machine.idle - lastMachine.idle) / Math.max(1, machine.total - lastMachine.total));
        lastMachine = machine;
        if (last) {
          samples.push({
            cpu: (100 * (cpu - last.cpu)) / ((at - last.at) / 1000),
            rss: readMetric(text, 'xiro_process_resident_memory_bytes') / 1_048_576,
            heap: readMetric(text, 'xiro_process_heap_used_bytes') / 1_048_576,
            loop: readMetric(text, 'xiro_event_loop_delay_p99_seconds') * 1000,
            pool: readMetric(text, 'xiro_db_pool_connections{state="total"}'),
            waiting: readMetric(text, 'xiro_db_pool_waiting'),
            machine: machinePct,
          });
        }
        last = { at, cpu };
      } catch {
        // una muestra perdida bajo carga extrema no invalida la prueba
      }
      await sleep(1000);
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      const max = (key: keyof (typeof samples)[number]) => Math.max(0, ...samples.map((s) => s[key]));
      const avg = (key: keyof (typeof samples)[number]) => (samples.length ? samples.reduce((a, s) => a + s[key], 0) / samples.length : 0);
      return {
        apiCpuAvgPct: round(avg('cpu')),
        apiCpuMaxPct: round(max('cpu')),
        machineCpuAvgPct: round(avg('machine')),
        apiRssMaxMb: round(max('rss')),
        heapMaxMb: round(max('heap')),
        eventLoopP99MaxMs: round(max('loop')),
        poolMax: max('pool'),
        poolWaitingMax: max('waiting'),
      };
    },
  };
}

/* ---------- Escenarios con autocannon ---------- */

export interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ScenarioResult {
  name: string;
  connections: number;
  durationSeconds: number;
  requests: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errorRatePct: number;
  statuses: Record<string, number>;
  transportErrors: number;
  resources: ResourceSummary;
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! : 0);

/**
 * Corre un escenario: `connections` usuarios virtuales concurrentes durante `durationSeconds`, cada uno pidiendo lo que
 * devuelva `next()` en bucle cerrado (sin pausa: mide el máximo que aguanta el servidor). Latencias exactas (no
 * histogramas) para P50/P95/P99. Error = respuesta no 2xx que no esté en okStatuses, o fallo de transporte (timeout).
 */
export async function runScenario(
  name: string,
  opts: {
    connections: number;
    durationSeconds: number;
    metricsToken: string;
    next: () => RequestSpec;
    /** Códigos que son respuesta correcta del negocio aunque no sean 2xx (p. ej. 409 = ese horario ya lo tomó otro). */
    okStatuses?: number[];
  },
): Promise<ScenarioResult> {
  const latencies: number[] = [];
  const statuses: Record<string, number> = {};
  const accepted = new Set(opts.okStatuses ?? []);
  let errors = 0;
  const sampler = sampleResources(opts.metricsToken);
  const started = performance.now();

  let finish!: (result: autocannon.Result) => void;
  let fail!: (error: unknown) => void;
  const done = new Promise<autocannon.Result>((resolve, reject) => ((finish = resolve), (fail = reject)));
  const instance = autocannon({
    url: BASE,
    connections: opts.connections,
    duration: opts.durationSeconds,
    timeout: 30,
    requests: [
      {
        setupRequest: (request) => {
          const spec = opts.next();
          return {
            ...request,
            method: spec.method,
            path: spec.path,
            // Como la app y el navegador reales: aceptan gzip (la API comprime respuestas de más de 1 KB).
            headers: { 'x-forwarded-for': nextIp(), 'accept-encoding': 'gzip', ...(spec.body === undefined ? {} : { 'content-type': 'application/json' }), ...spec.headers },
            body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
          };
        },
      },
    ],
  }, (error, result) => (error ? fail(error) : finish(result)));
  instance.on('response', (_client: unknown, statusCode: number, _bytes: number, responseTime: number) => {
    latencies.push(responseTime);
    statuses[statusCode] = (statuses[statusCode] ?? 0) + 1;
    if (statusCode >= 300 && !accepted.has(statusCode)) errors += 1;
  });
  const result = await done;
  const elapsed = (performance.now() - started) / 1000;
  const resources = await sampler.stop();

  latencies.sort((a, b) => a - b);
  // result.errors incluye los timeouts y las conexiones caídas (peticiones sin respuesta).
  const transportErrors = result.errors;
  const total = latencies.length + transportErrors;
  return {
    name,
    connections: opts.connections,
    durationSeconds: round(elapsed),
    requests: latencies.length,
    rps: round(latencies.length / Math.min(elapsed, opts.durationSeconds)),
    p50: round(percentile(latencies, 50)),
    p95: round(percentile(latencies, 95)),
    p99: round(percentile(latencies, 99)),
    max: round(latencies.at(-1) ?? 0),
    errorRatePct: round((100 * (errors + transportErrors)) / Math.max(1, total), 2),
    statuses,
    transportErrors,
    resources,
  };
}
