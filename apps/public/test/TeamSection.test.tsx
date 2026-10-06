import type { PublicServiceDto, PublicTeamMemberDto } from '@xiro/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TeamSection } from '../src/profile/TeamSection';

const service = (over: Partial<PublicServiceDto> = {}): PublicServiceDto => ({ id: 'svc1', name: 'Corte', category: 'Cabello', description: '', price: 30_000, durationMinutes: 30, image: null, images: [], variants: [], ...over });
const member = (over: Partial<PublicTeamMemberDto> = {}): PublicTeamMemberDto => ({ id: 'm1', name: 'Ana Ríos', bio: '', photoUrl: null, serviceIds: [], ...over });

describe('TeamSection', () => {
  it('sin profesionales, no dibuja nada', () => {
    const { container } = render(<TeamSection team={[]} services={[]} language="es" />);
    expect(container.firstChild).toBeNull();
  });

  it('al tocar una tarjeta se abre el modal con su bio y los servicios que realiza', async () => {
    const team = [member({ id: 'm1', name: 'Ana Ríos', bio: 'Estilista hace 8 años', serviceIds: ['svc1', 'svc2'] })];
    const services = [service({ id: 'svc1', name: 'Corte' }), service({ id: 'svc2', name: 'Color' }), service({ id: 'svc3', name: 'Manicure' })];
    render(<TeamSection team={team} services={services} language="es" />);
    await userEvent.click(screen.getByRole('button', { name: /Ana Ríos/ }));
    const dialog = screen.getByRole('dialog', { name: 'Ana Ríos' });
    expect(dialog.textContent).toContain('Estilista hace 8 años');
    expect(dialog.textContent).toContain('Corte');
    expect(dialog.textContent).toContain('Color');
    expect(dialog.textContent).not.toContain('Manicure'); // no está en serviceIds de Ana
  });

  it('sin bio ni servicios, el modal solo muestra lo disponible (nombre e iniciales) sin secciones vacías', async () => {
    const team = [member({ id: 'm2', name: 'Luis Gómez', bio: '', serviceIds: [] })];
    render(<TeamSection team={team} services={[]} language="es" />);
    await userEvent.click(screen.getByRole('button', { name: /Luis Gómez/ }));
    const dialog = screen.getByRole('dialog', { name: 'Luis Gómez' });
    expect(within(dialog).getByText('L')).toBeTruthy(); // iniciales como respaldo sin foto
    expect(dialog.textContent).not.toContain('Servicios que realiza');
  });

  it('el modal se cierra con Escape y devuelve el foco a la tarjeta', async () => {
    const team = [member({ id: 'm1', name: 'Ana Ríos' })];
    render(<TeamSection team={team} services={[]} language="es" />);
    const trigger = screen.getByRole('button', { name: /Ana Ríos/ });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
