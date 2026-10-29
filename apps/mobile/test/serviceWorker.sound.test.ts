import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * public/sw.js ejecutado con un entorno de Service Worker simulado: comprueba qué aviso muestra (con o sin sonido) según
 * conteste la página. No se envía ninguna notificación real.
 */
const SOURCE = readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');

interface FakeClient {
  visibilityState: 'visible' | 'hidden';
  focused: boolean;
  postMessage: ReturnType<typeof vi.fn>;
}

function client(visibilityState: FakeClient['visibilityState'], answer: boolean | 'never', focused = false): FakeClient {
  return {
    visibilityState,
    focused,
    postMessage: vi.fn((_message: unknown, ports: MessagePort[]) => {
      if (answer !== 'never') ports[0]!.postMessage({ played: answer });
    }),
  };
}

async function receivePush(clients: FakeClient[], payload = { title: 'Nueva cita', body: 'Mañana 10:00' }) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn(async () => undefined);
  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) => (handlers[type] = handler),
    skipWaiting: vi.fn(),
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => clients), claim: vi.fn(), openWindow: vi.fn() },
  };
  new Function('self', SOURCE)(self);
  let done: Promise<unknown> = Promise.resolve();
  handlers.push!({ data: { json: () => payload, text: () => '' }, waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
  return showNotification;
}

describe('service worker: sonido de Xiro sin duplicados', () => {
  it('la página visible reprodujo el sonido: el aviso del sistema sale en SILENCIO', async () => {
    const tab = client('visible', true, true);
    const show = await receivePush([tab]);
    expect(tab.postMessage).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith('Nueva cita', expect.objectContaining({ body: 'Mañana 10:00', silent: true }));
  });

  it('con varias pestañas, solo se le pide sonar a UNA (la enfocada)', async () => {
    const a = client('visible', true, false);
    const b = client('visible', true, true);
    const hidden = client('hidden', true);
    await receivePush([a, b, hidden]);
    expect(b.postMessage).toHaveBeenCalledOnce();
    expect(a.postMessage).not.toHaveBeenCalled();
    expect(hidden.postMessage).not.toHaveBeenCalled();
  });

  it('sin pestaña visible, la página no pudo sonar o no contestó a tiempo: aviso como antes (no silencioso)', async () => {
    expect(await receivePush([client('hidden', true)])).toHaveBeenCalledWith('Nueva cita', expect.objectContaining({ silent: false }));
    expect(await receivePush([client('visible', false)])).toHaveBeenCalledWith('Nueva cita', expect.objectContaining({ silent: false }));
    vi.useFakeTimers();
    try {
      const pending = receivePush([client('visible', 'never')]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toHaveBeenCalledWith('Nueva cita', expect.objectContaining({ silent: false }));
    } finally {
      vi.useRealTimers();
    }
  });
});
