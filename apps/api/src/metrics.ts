import { monitorEventLoopDelay } from 'node:perf_hooks';
import type pg from 'pg';
import { passwordQueueStats } from './passwords';

/**
 * Métricas básicas en formato Prometheus (Fase 4), sin dependencias: peticiones por ruta/estado y su latencia, memoria,
 * demora del event loop, conexiones del pool de PostgreSQL y la cola de contraseñas. GET /api/metrics, protegida por
 * METRICS_TOKEN (ver app.ts). Las etiquetas usan la PLANTILLA de la ruta (`/api/clients/:id`), nunca la URL real: ni
 * datos personales ni una serie nueva por cada id.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Histogram {
  counts: number[];
  sum: number;
  count: number;
}

export class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Histogram>();
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private readonly startedAt = Date.now();

  /** Cola de descargas PDF/Excel (exports/pool.ts); la asigna buildApp. */
  exportStats: (() => { running: number; waiting: number }) | null = null;

  constructor(private readonly pool: pg.Pool | null) {
    this.loop.enable();
  }

  observe(method: string, route: string, status: number, seconds: number): void {
    const statusClass = `${Math.floor(status / 100)}xx`;
    const requestKey = `method="${method}",route="${escapeLabel(route)}",status="${statusClass}"`;
    this.requests.set(requestKey, (this.requests.get(requestKey) ?? 0) + 1);
    const durationKey = `method="${method}",route="${escapeLabel(route)}"`;
    let histogram = this.durations.get(durationKey);
    if (!histogram) {
      histogram = { counts: BUCKETS.map(() => 0), sum: 0, count: 0 };
      this.durations.set(durationKey, histogram);
    }
    BUCKETS.forEach((bound, index) => {
      if (seconds <= bound) histogram.counts[index]! += 1;
    });
    histogram.sum += seconds;
    histogram.count += 1;
  }

  render(): string {
    const lines: string[] = [];
    const metric = (name: string, type: string, help: string) => lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);

    metric('xiro_http_requests_total', 'counter', 'Peticiones atendidas por método, ruta y clase de estado.');
    for (const [labels, value] of this.requests) lines.push(`xiro_http_requests_total{${labels}} ${value}`);

    metric('xiro_http_request_duration_seconds', 'histogram', 'Duración de las peticiones (segundos).');
    for (const [labels, h] of this.durations) {
      BUCKETS.forEach((bound, index) => lines.push(`xiro_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${h.counts[index]}`));
      lines.push(`xiro_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`);
      lines.push(`xiro_http_request_duration_seconds_sum{${labels}} ${h.sum.toFixed(6)}`);
      lines.push(`xiro_http_request_duration_seconds_count{${labels}} ${h.count}`);
    }

    const memory = process.memoryUsage();
    metric('xiro_process_resident_memory_bytes', 'gauge', 'Memoria residente del proceso.');
    lines.push(`xiro_process_resident_memory_bytes ${memory.rss}`);
    metric('xiro_process_heap_used_bytes', 'gauge', 'Heap de V8 en uso.');
    lines.push(`xiro_process_heap_used_bytes ${memory.heapUsed}`);
    const cpu = process.cpuUsage();
    metric('xiro_process_cpu_seconds_total', 'counter', 'Tiempo de CPU (usuario + sistema) consumido por el proceso.');
    lines.push(`xiro_process_cpu_seconds_total ${((cpu.user + cpu.system) / 1e6).toFixed(3)}`);
    metric('xiro_process_uptime_seconds', 'gauge', 'Segundos desde que arrancó el proceso.');
    lines.push(`xiro_process_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    metric('xiro_event_loop_delay_p99_seconds', 'gauge', 'Demora del event loop, percentil 99 (desde el último muestreo).');
    lines.push(`xiro_event_loop_delay_p99_seconds ${(this.loop.percentile(99) / 1e9).toFixed(6)}`);
    this.loop.reset();

    if (this.pool) {
      metric('xiro_db_pool_connections', 'gauge', 'Conexiones del pool de PostgreSQL por estado.');
      lines.push(`xiro_db_pool_connections{state="total"} ${this.pool.totalCount}`, `xiro_db_pool_connections{state="idle"} ${this.pool.idleCount}`);
      metric('xiro_db_pool_waiting', 'gauge', 'Peticiones esperando una conexión libre (si crece, el pool es chico o hay consultas lentas).');
      lines.push(`xiro_db_pool_waiting ${this.pool.waitingCount}`);
    }

    const hashing = passwordQueueStats();
    metric('xiro_password_hash_running', 'gauge', 'Hashes de contraseña en curso.');
    lines.push(`xiro_password_hash_running ${hashing.running}`);
    metric('xiro_password_hash_waiting', 'gauge', 'Hashes de contraseña en cola.');
    lines.push(`xiro_password_hash_waiting ${hashing.waiting}`);

    if (this.exportStats) {
      const exports = this.exportStats();
      metric('xiro_export_running', 'gauge', 'Descargas PDF/Excel generándose (como mucho EXPORT_WORKERS).');
      lines.push(`xiro_export_running ${exports.running}`);
      metric('xiro_export_waiting', 'gauge', 'Descargas esperando turno (si se acerca a EXPORT_QUEUE_MAX, las siguientes reciben 503).');
      lines.push(`xiro_export_waiting ${exports.waiting}`);
    }
    return `${lines.join('\n')}\n`;
  }

  close(): void {
    this.loop.disable();
  }
}

const escapeLabel = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
