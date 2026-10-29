import { EventEmitter } from 'node:events';
import pg from 'pg';
import type { DatabaseConfig } from './config';
import { poolOptions } from './db/client';

const CHANNEL = 'appointments_changed';

/** Qué cambió: las citas (la Agenda) o los pedidos de productos (Pedidos). */
export type RealtimeKind = 'appointments' | 'orders';

export interface RealtimeBus {
  /** Se llama cada vez que algo cambió en las citas o pedidos de ESE negocio. Devuelve la función para dejar de escuchar. */
  onBusiness(businessId: string, handler: (kind: RealtimeKind) => void): () => void;
  close(): Promise<void>;
}

/**
 * Un único cliente de PostgreSQL dedicado (LISTEN exige una sesión fija, no sirve un pool) que reenvía cada aviso del
 * trigger de `appointments` (ver drizzle/0009_appointments_notify.sql) a quien esté escuchando ESE negocio. Si se cae
 * la conexión (reinicio del servidor, red), se reintenta con espera creciente; mientras tanto la Agenda simplemente no
 * recibe avisos — nunca es la fuente de verdad, así que no hay nada que perder salvo la actualización instantánea.
 */
export function createRealtimeBus(config: DatabaseConfig, log: (line: string) => void = console.error): RealtimeBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let closed = false;
  let client: pg.Client | null = null;
  let retryMs = 1_000;

  function connect(): void {
    if (closed) return;
    const options = poolOptions(config);
    // LISTEN exige una sesión fija: nunca a través de PgBouncer en modo transacción (`directUrl`, ver config.ts).
    const c = new pg.Client({ connectionString: config.directUrl ?? options.connectionString, ssl: options.ssl });
    client = c;
    c.on('notification', (msg) => {
      try {
        const { businessId, kind } = JSON.parse(msg.payload ?? '{}') as { businessId?: string; kind?: string };
        // Sin `kind` (el aviso del trigger de citas, ver 0009) = citas, como siempre.
        if (businessId) emitter.emit(businessId, kind === 'orders' ? 'orders' : 'appointments');
      } catch {
        // Aviso con un payload que no es el que manda el disparador: se ignora, nunca debe tumbar el proceso.
      }
    });
    c.on('error', (error) => log(`[realtime] conexión perdida: ${error.message}`));
    c.on('end', () => {
      if (closed) return;
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    });
    c.connect()
      .then(() => c.query(`LISTEN ${CHANNEL}`))
      .then(() => {
        retryMs = 1_000;
      })
      .catch((error: Error) => {
        log(`[realtime] no se pudo conectar: ${error.message}`);
        c.end().catch(() => undefined);
      });
  }
  connect();

  return {
    onBusiness(businessId, handler) {
      emitter.on(businessId, handler);
      return () => emitter.off(businessId, handler);
    },
    async close() {
      closed = true;
      await client?.end().catch(() => undefined);
    },
  };
}
