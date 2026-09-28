import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { useRealtimeAppointments } from '../src/lib/realtime.web';

vi.mock('../src/lib/api', () => ({ api: { eventsTicket: vi.fn() }, apiBaseUrl: () => 'http://api.test' }));

/** Sustituto mínimo de `EventSource`: solo lo que el hook usa (constructor con la URL, un listener con nombre, cerrar). */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<() => void>>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }
  emit(type: string) {
    for (const cb of this.listeners.get(type) ?? []) cb();
  }
  fail() {
    this.onerror?.();
  }
  close() {
    this.closed = true;
  }
}

function Harness({ onChange }: { onChange: () => void }) {
  useRealtimeAppointments(onChange);
  return null;
}

describe('useRealtimeAppointments (web): SSE de la Agenda', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances.length = 0;
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    vi.mocked(api.eventsTicket).mockResolvedValue({ ticket: 'tk1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('pide un ticket de un solo uso y abre el stream con él en la URL', async () => {
    render(<Harness onChange={() => {}} />);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0]!.url).toBe('http://api.test/api/booking/events?ticket=tk1');
  });

  it('llama a onChange cuando llega el evento "appointments" (nunca antes)', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(onChange).not.toHaveBeenCalled();
    FakeEventSource.instances[0]!.emit('appointments');
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('si el stream falla, cierra esa conexión y unos segundos después abre una nueva con OTRO ticket', async () => {
    vi.mocked(api.eventsTicket).mockResolvedValueOnce({ ticket: 'tk1' }).mockResolvedValueOnce({ ticket: 'tk2' });
    render(<Harness onChange={() => {}} />);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]!.fail();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1]!.url).toContain('tk2');
  });

  it('al desmontar cierra el stream y no vuelve a intentar nada', async () => {
    const { unmount } = render(<Harness onChange={() => {}} />);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    unmount();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
