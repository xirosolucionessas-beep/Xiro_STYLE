import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ItemDetailModal } from '../src/profile/ItemDetailModal';

/** Detalle de servicio/producto a pantalla completa: tema oscuro propio, carrusel de fotos y X para volver. */
const item = { id: 'i1', name: 'Color y mechas', category: 'Cabello', description: 'Diagnóstico y brillo.', images: ['/media/a.jpg', '/media/b.jpg', '/media/c.jpg'], durationMinutes: 150, price: 180000 };

function renderDetail(over: Partial<typeof item> = {}) {
  const onClose = vi.fn();
  const onBook = vi.fn();
  render(<ItemDetailModal item={{ ...item, ...over }} currency="COP" language="es" canBook onBook={onBook} onClose={onClose} />);
  return { onClose, onBook, dialog: screen.getByRole('dialog', { name: 'Color y mechas' }) };
}

describe('detalle inmersivo', () => {
  it('es una vista a pantalla completa con la X visible que cierra y vuelve a la página', async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = renderDetail();
    expect(dialog.className).toContain('xp-modal--full');
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('carrusel: todas las fotos, contador, flechas (en ciclo) y miniaturas', async () => {
    const user = userEvent.setup();
    const { dialog } = renderDetail();
    const carousel = within(dialog).getByRole('region', { name: 'Color y mechas' });
    expect(carousel.querySelectorAll('.xp-carousel-slide img')).toHaveLength(3);
    expect(within(carousel).getByText('1 de 3')).toBeTruthy();
    await user.click(within(carousel).getByRole('button', { name: 'Foto siguiente' }));
    expect(within(carousel).getByText('2 de 3')).toBeTruthy();
    await user.click(within(carousel).getByRole('button', { name: 'Foto anterior' }));
    await user.click(within(carousel).getByRole('button', { name: 'Foto anterior' }));
    expect(within(carousel).getByText('3 de 3')).toBeTruthy();
    await user.click(within(carousel).getByRole('tab', { name: '1 de 3' }));
    expect(within(carousel).getByRole('tab', { name: '1 de 3' }).getAttribute('aria-selected')).toBe('true');
  });

  it('una sola foto: sin flechas ni miniaturas; sin fotos: un ícono neutro', () => {
    const { dialog } = renderDetail({ images: ['/media/a.jpg'] });
    expect(within(dialog).queryByRole('button', { name: 'Foto siguiente' })).toBeNull();
    expect(within(dialog).queryByRole('tablist')).toBeNull();
    document.body.innerHTML = '';
    const empty = renderDetail({ images: [] });
    expect(empty.dialog.querySelector('.xp-carousel--empty')).toBeTruthy();
  });

  it('"Reservar" sigue haciendo lo mismo de siempre', async () => {
    const user = userEvent.setup();
    const { dialog, onBook } = renderDetail();
    await user.click(within(dialog).getByRole('button', { name: /Color y mechas/ }));
    expect(onBook).toHaveBeenCalled();
  });
});
