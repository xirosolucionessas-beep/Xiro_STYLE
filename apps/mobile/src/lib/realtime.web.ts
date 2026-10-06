import { useEffect, useRef } from 'react';
import { api, apiBaseUrl } from './api';

const RETRY_MS = 5_000;

/**
 * Mientras algo esté montado, mantiene abierto el stream de "algo cambió en tus citas" (SSE) y llama `onChange` cada
 * vez que llega un aviso: la Agenda se refresca sola, sin encuestar. `EventSource` no puede mandar el header de
 * sesión, así que cada conexión empieza pidiendo un ticket de un solo uso (30s) a la ruta autenticada de siempre.
 *
 * Si la conexión se cae (red, el propio ticket ya venció), NO se deja el reintento automático del navegador — reabre
 * con un ticket nuevo unos segundos después, porque el viejo ya no vale.
 */
export function useRealtimeAppointments(onChange: () => void): void {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      try {
        const { ticket } = await api.eventsTicket();
        if (closed) return;
        const es = new EventSource(`${apiBaseUrl()}/api/booking/events?ticket=${encodeURIComponent(ticket)}`);
        source = es;
        es.addEventListener('appointments', () => onChangeRef.current());
        es.onerror = () => {
          es.close();
          if (source === es) source = null;
          if (!closed) retryTimer = setTimeout(() => void connect(), RETRY_MS);
        };
      } catch {
        if (!closed) retryTimer = setTimeout(() => void connect(), RETRY_MS);
      }
    }
    void connect();

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, []);
}
