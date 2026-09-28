import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { useAsync } from '../src/lib/useAsync';

function Probe({ id, fetcher }: { id: number; fetcher: () => Promise<string> }) {
  const { data, loading, error, reload } = useAsync(fetcher, [id]);
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : error ? `error:${String((error as Error).message)}` : `data:${data}`}</span>
      <button onClick={reload}>reload</button>
    </div>
  );
}

function Host({ fetcher }: { fetcher: (id: number) => Promise<string> }) {
  const [id, setId] = useState(1);
  return (
    <div>
      <Probe id={id} fetcher={() => fetcher(id)} />
      <button onClick={() => setId((i) => i + 1)}>next</button>
    </div>
  );
}

describe('useAsync', () => {
  it('empieza cargando y muestra el dato al resolver', async () => {
    const fetcher = vi.fn(() => Promise.resolve('hola'));
    render(<Probe id={1} fetcher={fetcher} />);
    expect(screen.getByTestId('state').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('data:hola'));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('expone el error cuando la promesa rechaza', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('boom')));
    render(<Probe id={1} fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('error:boom'));
  });

  it('vuelve a pedir cuando cambian las dependencias, y "reload" repite la misma petición', async () => {
    let n = 0;
    const pending: Array<() => void> = [];
    const fetcher = vi.fn((id: number) => {
      n += 1;
      const label = `v${id}-${n}`;
      return new Promise<string>((resolve) => pending.push(() => resolve(label)));
    });
    const user = userEvent.setup();
    render(<Host fetcher={fetcher} />);
    expect(screen.getByTestId('state').textContent).toBe('loading');
    pending[0]!();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('data:v1-1'));

    await user.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByTestId('state').textContent).toBe('loading'); // cambia de inmediato, sin esperar la respuesta
    pending[1]!();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('data:v2-2'));

    await user.click(screen.getByRole('button', { name: 'reload' }));
    expect(screen.getByTestId('state').textContent).toBe('loading');
    pending[2]!();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('data:v2-3'));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('ignora una respuesta que llega tarde de una petición ya reemplazada (evita condiciones de carrera)', async () => {
    const calls: Array<{ resolve: (v: string) => void }> = [];
    const fetcher = vi.fn(() => new Promise<string>((resolve) => calls.push({ resolve })));
    const user = userEvent.setup();
    render(<Host fetcher={fetcher} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(calls).toHaveLength(2));

    calls[0]!.resolve('vieja'); // la primera petición responde después de que ya se pidió la segunda
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('state').textContent).toBe('loading'); // no se coló el dato viejo

    calls[1]!.resolve('nueva');
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('data:nueva'));
  });

  it('errorKey traduce un ApiError sin red a "offline_error" y cualquier otro a su código', async () => {
    const { errorKey } = await import('../src/lib/useAsync');
    expect(errorKey(new ApiError(0, 'unused'))).toBe('offline_error');
    expect(errorKey(new ApiError(409, 'slot_taken'))).toBe('slot_taken');
    expect(errorKey(new Error('x'))).toBe('unknown_error');
  });
});
