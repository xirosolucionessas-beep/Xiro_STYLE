import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Calendar } from '../src/ui/Calendar';

describe('Calendar', () => {
  it('marca los días con y sin cupo, en el texto accesible (no solo en el color)', () => {
    render(<Calendar value="2026-10-06" today="2026-10-05" marks={{ '2026-10-06': 'available', '2026-10-07': 'full' }} onChange={vi.fn()} language="es" />);
    expect(screen.getByRole('radio', { name: /^martes, 6 de octubre, con cupo/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^miércoles, 7 de octubre, sin cupo/ })).toBeTruthy();
  });

  const disabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

  it('un día pasado o más allá del máximo está deshabilitado', () => {
    render(<Calendar value="2026-10-06" today="2026-10-06" maxDate="2026-10-10" onChange={vi.fn()} language="es" />);
    expect(disabled(screen.getByRole('radio', { name: /, 5 de octubre/ }))).toBe(true);
    expect(disabled(screen.getByRole('radio', { name: /, 11 de octubre/ }))).toBe(true);
    expect(disabled(screen.getByRole('radio', { name: /, 6 de octubre/ }))).toBe(false);
    expect(disabled(screen.getByRole('radio', { name: /, 10 de octubre/ }))).toBe(false);
  });

  it('un día cerrado está deshabilitado aunque sea futuro', () => {
    render(<Calendar value="2026-10-06" today="2026-10-05" marks={{ '2026-10-08': 'closed' }} onChange={vi.fn()} language="es" />);
    expect(disabled(screen.getByRole('radio', { name: /, 8 de octubre/ }))).toBe(true);
  });

  it('elegir un día llama a onChange; cambiar de mes no', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Calendar value="2026-10-06" today="2026-10-05" onChange={onChange} language="es" />);
    await user.click(screen.getByRole('radio', { name: /, 15 de octubre/ }));
    expect(onChange).toHaveBeenCalledWith('2026-10-15');

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByText(/noviembre de 2026/i)).toBeTruthy();
    expect(onChange).toHaveBeenCalledOnce(); // el cambio de mes no cuenta como elegir un día
  });

  it('en inglés usa nombres de mes y día en inglés', () => {
    render(<Calendar value="2026-10-06" today="2026-10-05" onChange={vi.fn()} language="en" />);
    expect(screen.getByText(/October 2026/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Tuesday, October 6/ })).toBeTruthy();
  });
});
