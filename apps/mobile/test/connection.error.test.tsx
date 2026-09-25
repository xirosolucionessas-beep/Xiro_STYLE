import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { translate } from '@xiro/shared';
import { ConnectionError } from '../src/ui/ConnectionError.web';

vi.mock('@/lib/settings', () => ({ useSettings: () => ({ t: (key: string) => translate('es', key) }) }));

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

describe('Pantalla "Sin conexión con el servidor" (web)', () => {
  it('es una alerta con título, mensaje y un botón "Reintentar conexión" contenido; pasa axe', async () => {
    const { container } = render(<ConnectionError retrying={false} onRetry={vi.fn()} />);
    const alert = screen.getByRole('alert');
    expect(screen.getByRole('heading', { level: 1, name: 'Sin conexión con el servidor' })).toBeTruthy();
    expect(alert.textContent).toContain('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
    const retry = screen.getByRole('button', { name: 'Reintentar conexión' });
    expect(retry.className).toContain('xw-btn--primary');
    expect(retry.className).not.toContain('xw-btn--block'); // ancho automático, no de lado a lado
    expect(document.activeElement).toBe(retry);
    await noViolations(container);
  });

  it('al hacer clic reintenta una vez y muestra el indicador de carga', async () => {
    const onRetry = vi.fn();
    render(<ConnectionError retrying={false} onRetry={onRetry} />);
    const retry = screen.getByRole('button', { name: 'Reintentar conexión' });
    expect(retry.querySelector('.xw-spinner')).toBeNull();
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(retry.querySelector('.xw-spinner')).toBeTruthy();
    expect(retry.getAttribute('aria-busy')).toBe('true');
  });

  it('mientras la sesión se vuelve a comprobar el botón sigue ocupado, sin necesidad de clic', () => {
    render(<ConnectionError retrying onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Reintentar conexión/ }).querySelector('.xw-spinner')).toBeTruthy();
  });
});
