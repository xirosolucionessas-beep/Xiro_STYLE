import type { PublicBookingCatalog, PublicBookingProfile } from '@xiro/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { publicApi } from '../src/api';
import { BookingFlow } from '../src/booking/BookingFlow';
import { ProfileSkeleton } from '../src/ui/Skeleton';

import type * as ApiModule from '../src/api';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, publicApi: { ...actual.publicApi, availability: vi.fn(), days: vi.fn() } };
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const profile = {
  slug: 'luna', name: 'Estudio Luna', tagline: '', description: '', conditions: '', privacyPolicy: '', address: '', city: '', country: 'Colombia', phone: null, whatsapp: null, instagram: '', facebook: '', tiktok: '', website: '',
  latitude: null, longitude: null, mapAddress: '', placeId: null, mapImageUrl: null, logoUrl: null, coverUrl: '/media/portada-generica.png', gallery: [], timezone: 'America/Bogota', currency: 'COP',
  sections: { services: true, products: true, team: true, reviews: true, gallery: true, map: true }, hours: [], openNow: true, openStatus: { open: true, changesAt: '2026-10-06T00:00:00.000Z' },
  acceptsBookings: true, acceptsProductOrders: false, rating: { average: null, count: 0 }, rules: { slotIntervalMinutes: 30, maxDaysAhead: 60, cancelUntilHours: 2, maxModifications: 2, requireEmail: false, customFields: [] },
  captchaSiteKey: null, accentColor: null, bookingTitle: '', trustBadges: [], features: { waitlist: false, discountCodes: false, rememberCustomer: false, noPrepayBadge: false, customerNotes: true }, businessType: 'barbershop',
} satisfies PublicBookingProfile;
const catalog: PublicBookingCatalog = {
  services: [
    { id: A, name: 'Corte', category: 'Cabello', description: '', price: 30000, durationMinutes: 60, image: null, images: [], variants: [] },
    { id: B, name: 'Color', category: 'Cabello', description: '', price: 90000, durationMinutes: 90, image: '/media/color.jpg', images: ['/media/color.jpg'], variants: [] },
  ],
  packages: [],
  products: [{ id: C, name: 'Cera', description: '', price: 15000, image: '/media/cera.jpg', images: ['/media/cera.jpg'], inStock: true }],
};

describe('foto del resumen "Tu cita"', () => {
  it('nunca la portada fija del negocio: la foto del primer artículo elegido que tenga foto, y cambia con la selección', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.days).mockResolvedValue([]);
    render(<BookingFlow slug="luna" profile={profile} catalog={catalog} team={[]} language="es" onClose={vi.fn()} />);
    const summary = screen.getByRole('complementary', { name: 'Tu cita' });
    expect(summary.querySelector('img')).toBeNull(); // sin nada elegido: sin imagen (antes, la portada genérica)
    await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
    expect(summary.querySelector('img')).toBeNull(); // el servicio elegido no tiene foto
    await user.click(screen.getByRole('checkbox', { name: /Color/ }));
    expect(within(summary).getByRole('img', { name: 'Color' }).getAttribute('src')).toBe('/media/color.jpg');
    // Se quita "Color" y se agrega un producto con foto: el resumen muestra la del producto.
    await user.click(screen.getByRole('checkbox', { name: /Color/ }));
    expect(summary.querySelector('img')).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ Cera' }));
    expect(within(summary).getByRole('img', { name: 'Cera' }).getAttribute('src')).toBe('/media/cera.jpg');
    expect(summary.innerHTML).not.toContain('portada-generica');
  });
});

describe('foto del resumen: completa y ampliable', () => {
  it('se ve entera (contain); al tocarla abre el visor con TODAS las fotos del artículo; Esc cierra solo el visor', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(publicApi.days).mockResolvedValue([]);
    const many = { ...catalog, services: [{ ...catalog.services[1]!, images: ['/media/color.jpg', '/media/color-2.jpg', '/media/color-3.jpg'] }] };
    render(<BookingFlow slug="luna" profile={profile} catalog={many} team={[]} language="es" onClose={onClose} />);
    await user.click(screen.getByRole('checkbox', { name: /Color/ }));
    const summary = screen.getByRole('complementary', { name: 'Tu cita' });
    expect(within(summary).getByRole('img', { name: 'Color' }).className).toContain('xp-sum-cover--contain');
    await user.click(within(summary).getByRole('button', { name: 'Ampliar foto 1 de 3' }));
    const viewer = screen.getByRole('dialog', { name: '1 de 3' });
    await user.click(within(viewer).getByRole('button', { name: 'Foto siguiente' }));
    expect(screen.getByRole('dialog', { name: '2 de 3' }).querySelector('img')!.getAttribute('src')).toBe('/media/color-2.jpg');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /de 3/ })).toBeNull();
    expect(onClose).not.toHaveBeenCalled(); // el flujo de reserva sigue abierto con lo elegido
    expect(screen.getByRole('checkbox', { name: /Color/ })).toHaveProperty('checked', true);
  });
});

describe('carga lenta de la página', () => {
  it('a los pocos segundos avisa y ofrece reintentar (no se queda solo con rectángulos)', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(<ProfileSkeleton label="Cargando" slow={{ text: 'Está tardando más de lo normal.', cta: 'Reintentar', onRetry }} />);
    expect(screen.queryByText('Está tardando más de lo normal.')).toBeNull();
    act(() => vi.advanceTimersByTime(6500));
    expect(screen.getByText('Está tardando más de lo normal.')).toBeTruthy();
    screen.getByRole('button', { name: 'Reintentar' }).click();
    expect(onRetry).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
