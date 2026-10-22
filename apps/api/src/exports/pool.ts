import { Worker } from 'node:worker_threads';
import { AppError } from '../errors';
import { buildExport, type ExportJob } from './build';

/**
 * Grupo de hilos de trabajo para las descargas PDF/Excel.
 *
 * Generar un archivo es trabajo de CPU síncrono (pdfkit, exceljs). En el hilo principal de Node bloqueaba a TODAS las demás
 * peticiones de la instancia: medido, un Excel del balance de 30 días lo bloqueaba ~1,2 s y un PDF ~1 s, por encima del
 * umbral (1 s) con que la API se protege respondiendo 503 a todos (docs/finance-capacity.md). Aquí:
 *  - cada archivo se arma en un hilo aparte (`workers` hilos, creados al primer uso);
 *  - nunca hay más de `workers` archivos generándose a la vez (también acota la memoria);
 *  - los demás esperan en cola, como mucho `queueMax`; con la cola llena → 503 "server_busy" con Retry-After;
 *  - un archivo que tarda más de `timeoutMs` se corta (se termina ese hilo y se crea otro) → 503.
 * Con `workers` = 0 se genera en el hilo principal (como antes), con la misma cola.
 */
export interface ExportPoolOptions {
  workers: number;
  queueMax: number;
  timeoutMs: number;
  /** Tope del heap de cada hilo (MB). Por defecto 256: el peor caso permitido (Excel de 50.000 filas, por flujo) usa ~35. */
  workerMemoryMb?: number;
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

type Pending = { resolve: (bytes: Buffer) => void; reject: (error: unknown) => void };

/**
 * __BUNDLED__ lo define esbuild en tiempo de compilación (ver apps/api/package.json → "build" y Dockerfile): true
 * SOLO en dist/server.js, el empaquetado de producción, donde worker.ts ya es worker.js plano y no existe tsx en
 * la imagen. En desarrollo/pruebas (tsx watch, vitest) queda en false y el hilo sigue necesitando el cargador de
 * TypeScript (tsx), igual que el proceso principal.
 */
declare const __BUNDLED__: boolean;

function workerExecArgv(): string[] {
  if (typeof __BUNDLED__ !== 'undefined' && __BUNDLED__) return process.execArgv;
  return process.execArgv.some((arg) => arg.includes('tsx')) ? process.execArgv : [...process.execArgv, '--import', 'tsx'];
}

function workerUrl(): URL {
  return typeof __BUNDLED__ !== 'undefined' && __BUNDLED__ ? new URL('./worker.js', import.meta.url) : new URL('./worker.ts', import.meta.url);
}

export class ExportPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Array<() => void> = [];
  private running = 0;
  private nextId = 1;
  private closed = false;

  constructor(private readonly options: ExportPoolOptions) {}

  /** Estado (métricas / pruebas). */
  stats() {
    return { ...this.options, activeWorkers: this.slots.length, running: this.running, waiting: this.queue.length };
  }

  /** Genera el archivo; espera turno si ya hay `workers` en curso. */
  async run(job: ExportJob): Promise<Buffer> {
    if (this.closed) throw new AppError(503, 'server_busy', undefined, { 'Retry-After': '5' });
    const capacity = Math.max(1, this.options.workers);
    if (this.running < capacity) this.running += 1;
    else {
      if (this.queue.length >= this.options.queueMax) throw new AppError(503, 'server_busy', undefined, { 'Retry-After': '5' });
      // El turno se recibe ya ocupado (ver `finally`): nunca hay más de `capacity` archivos a la vez.
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    try {
      return this.options.workers === 0 ? await buildExport(job) : await this.inWorker(job);
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.running -= 1;
    }
  }

  private slot(): Slot {
    const free = this.slots.find((s) => !s.busy);
    if (free) return free;
    const slot: Slot = { worker: new Worker(workerUrl(), { execArgv: workerExecArgv(), resourceLimits: { maxOldGenerationSizeMb: this.options.workerMemoryMb ?? 256 } }), busy: false };
    // Un hilo inactivo no mantiene vivo el proceso (el cierre ordenado no lo espera).
    slot.worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private drop(slot: Slot) {
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    void slot.worker.terminate();
  }

  private inWorker(job: ExportJob): Promise<Buffer> {
    const slot = this.slot();
    slot.busy = true;
    const id = this.nextId++;
    return new Promise<Buffer>((resolve, reject) => {
      const pending: Pending = { resolve, reject };
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        slot.worker.off('message', onMessage);
        slot.worker.off('error', onError);
        slot.worker.off('exit', onExit);
        slot.busy = false;
        fn();
      };
      const onMessage = (message: { id: number; ok: boolean; bytes?: Uint8Array; error?: string }) => {
        if (message.id !== id) return;
        finish(() => (message.ok && message.bytes ? pending.resolve(Buffer.from(message.bytes.buffer, message.bytes.byteOffset, message.bytes.byteLength)) : pending.reject(new Error(message.error ?? 'export failed'))));
      };
      const onError = (error: Error) => {
        this.drop(slot);
        finish(() => pending.reject(error));
      };
      const onExit = (code: number) => {
        this.drop(slot);
        finish(() => pending.reject(new Error(`export worker exited (${code})`)));
      };
      // Un archivo colgado no deja la descarga esperando para siempre: se termina ese hilo (el próximo crea otro).
      const timer = setTimeout(() => {
        this.drop(slot);
        finish(() => pending.reject(new AppError(503, 'server_busy', 'Export timed out', { 'Retry-After': '5' })));
      }, this.options.timeoutMs);
      slot.worker.ref();
      slot.worker.on('message', onMessage);
      slot.worker.once('error', onError);
      slot.worker.once('exit', onExit);
      slot.worker.postMessage({ id, job });
    }).finally(() => {
      if (this.slots.includes(slot)) slot.worker.unref();
    });
  }

  /** Cierre ordenado de la API: termina los hilos. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.slots.splice(0).map((s) => s.worker.terminate()));
  }
}
