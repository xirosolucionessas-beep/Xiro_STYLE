import type { PublicBookingCatalog, PublicBookingProfile, PublicReviewDto } from '@xiro/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { publicApi } from '../src/api';
import { DetailsStep } from '../src/booking/steps';
import { ProfilePage } from '../src/pages/ProfilePage';

import type * as ApiModule from '../src/api';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, publicApi: { ...actual.publicApi, profile: vi.fn(), catalog: vi.fn(), team: vi.fn(), reviews: vi.fn() } };
});

/** Rediseño de la página pública: cabecera en dúo, jerarquía, reseñas reales, distintivo, comentarios y pie de página. */
const base: PublicBookingProfile = {
  slug: 'mi-barberia',
  name: 'Mi Barbería',
  tagline: 'Cortes con estilo',
  description: '',
  conditions: '',
  privacyPolicy: '',
  address: '',
  city: '',
  country: 'Colombia',
  phone: null,
  whatsapp: null,
  instagram: '',
  facebook: '',
  tiktok: '',
  website: '',
  latitude: null,
  longitude: null,
  mapAddress: '',
  placeId: null,
  mapImageUrl: null,
  logoUrl: null,
  coverUrl: null,
  gallery: [],
  timezone: 'America/Bogota',
  currency: 'COP',
  sections: { services: true, products: false, team: false, reviews: true, gallery: false, map: false },
  hours: [],
  openNow: false,
  openStatus: { open: false, changesAt: '2026-10-06T14:00:00.000Z' },
  acceptsBookings: true,
  acceptsProductOrders: false,
  rating: { average: null, count: 0 },
  rules: { slotIntervalMinutes: 30, maxDaysAhead: 60, cancelUntilHours: 2, maxModifications: 2, requireEmail: true, customFields: [] },
  captchaSiteKey: null,
  accentColor: null,
  bookingTitle: '',
  trustBadges: [],
  features: { waitlist: false, discountCodes: false, rememberCustomer: false, noPrepayBadge: false, customerNotes: true },
  businessType: 'barbershop',
};
const emptyCatalog: PublicBookingCatalog = { services: [], packages: [], products: [] };

async function open(data: Partial<PublicBookingProfile> = {}, reviewList: PublicReviewDto[] = []) {
  vi.mocked(publicApi.profile).mockResolvedValue({ ...base, ...data });
  vi.mocked(publicApi.catalog).mockResolvedValue(emptyCatalog);
  vi.mocked(publicApi.team).mockResolvedValue([]);
  vi.mocked(publicApi.reviews).mockResolvedValue(reviewList);
  const view = render(<ProfilePage slug="mi-barberia" language="es" />);
  await screen.findByRole('heading', { level: 1 });
  return view;
}

describe('cabecera en dúo', () => {
  it('la foto del negocio y su logo circular van LADO A LADO; debajo: nombre → calificación → tipo → dirección', async () => {
    const { container } = await open({ coverUrl: '/media/local.jpg', logoUrl: '/media/logo.png', address: 'Calle 1', city: 'Cali', rating: { average: 4.86, count: 246 } });
    const duo = container.querySelector('.xp-duo')!;
    expect(duo.querySelector('.xp-duo-photo img')!.getAttribute('src')).toBe('/media/local.jpg');
    expect(duo.querySelector('.xp-duo-logo img')!.getAttribute('src')).toBe('/media/logo.png');
    const order = ['.xp-duo', '.xp-name', '.xp-hero-rating', '.xp-hero-type', '.xp-hero-address'].map((s) => container.querySelector(s)!);
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rating = container.querySelector('.xp-hero-rating')!;
    expect(rating.textContent).toContain('4,9');
    expect(rating.textContent).toContain('246 reseñas');
    expect(rating.getAttribute('href')).toBe('#resenas');
    expect(container.querySelector('.xp-hero-type')!.textContent).toBe('Barbería');
    expect(container.querySelector('.xp-hero-address')!.textContent).toContain('Calle 1, Cali');
  });

  it('sin foto ni logo: recuadro e iniciales (nada se rompe); sin reseñas: "Sé el primero…" con estrellas vacías', async () => {
    const { container } = await open({ coverUrl: null, logoUrl: null, rating: { average: null, count: 0 } });
    expect(container.querySelector('.xp-duo-photo--empty')).toBeTruthy();
    expect(container.querySelector('.xp-duo-logo-fallback')!.textContent).toBe('M');
    expect(within(container.querySelector('.xp-hero') as HTMLElement).getByText('Sé el primero en compartir tu experiencia')).toBeTruthy();
  });

  it('el distintivo sin pago anticipado solo aparece si el negocio lo activó', async () => {
    const off = await open();
    expect(screen.queryByText('Reserva fácil · Sin pago anticipado')).toBeNull();
    off.unmount();
    await open({ features: { ...base.features, noPrepayBadge: true } });
    expect(screen.getByText('Reserva fácil · Sin pago anticipado')).toBeTruthy();
  });
});

describe('reseñas', () => {
  it('resumen con promedio y número reales, reseñas como texto (nunca HTML) y cómo dejar la propia', async () => {
    const { container } = await open({ rating: { average: 5, count: 1 } }, [{ rating: 5, comment: '<img src=x onerror=alert(1)> ¡Genial!', authorName: 'Ana R.', createdAt: '2026-10-01T00:00:00.000Z' } as PublicReviewDto]);
    const section = await screen.findByRole('region', { name: 'Reseñas' });
    expect(within(section).getAllByText('1 reseña').length).toBeGreaterThan(0);
    expect(await within(section).findByText('<img src=x onerror=alert(1)> ¡Genial!')).toBeTruthy();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(within(section).getByText(/Después de tu cita podrás calificarla/)).toBeTruthy();
  });
});

describe('comentarios al reservar', () => {
  const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${JSON.stringify(p)}` : k);
  const props = { customer: { firstName: '', lastName: '', phone: '', email: '', notes: '' }, custom: {}, errors: {}, t, onCustomer: () => undefined, onCustom: () => undefined };
  it('encendidos: campo opcional con contador; apagados: no aparece', () => {
    const on = render(<DetailsStep profile={base} {...props} />);
    expect(on.container.querySelector('#xp-notes')).toBeTruthy();
    expect(on.container.textContent).toContain('pub_chars_left');
    on.unmount();
    const off = render(<DetailsStep profile={{ ...base, features: { ...base.features, customerNotes: false } }} {...props} />);
    expect(off.container.querySelector('#xp-notes')).toBeNull();
  });
});

describe('pie de página', () => {
  it('Privacidad y Términos abren los textos del negocio; Ayuda va a su WhatsApp; sin textos ni contacto, ningún enlace falso', async () => {
    const user = userEvent.setup();
    const view = await open({ privacyPolicy: 'No compartimos tus datos.', conditions: 'Llega 5 minutos antes.', whatsapp: '573001234567' });
    const footer = view.container.querySelector('footer') as HTMLElement;
    await user.click(within(footer).getByRole('button', { name: 'Privacidad' }));
    expect(screen.getByRole('dialog', { name: 'Política de privacidad' }).textContent).toContain('No compartimos tus datos.');
    await user.keyboard('{Escape}');
    expect(within(footer).getByRole('button', { name: 'Términos' })).toBeTruthy();
    expect(within(footer).getByRole('link', { name: 'Ayuda' }).getAttribute('href')).toContain('573001234567');
    view.unmount();
    const bare = await open();
    expect(bare.container.querySelector('.xp-footer-links')).toBeNull();
  });
});

describe('perfil del empleado y ficha del artículo', () => {
  it('el perfil del empleado se cierra solo con la X de arriba (sin botón "Cerrar" abajo)', async () => {
    const user = userEvent.setup();
    const { TeamSection } = await import('../src/profile/TeamSection');
    render(<TeamSection team={[{ id: 'm1', name: 'Laura', bio: 'Colorista', specialty: '', rating: null, photoUrl: null, serviceIds: [] }]} services={[]} language="es" />);
    await user.click(screen.getByRole('button', { name: /Laura/ }));
    const dialog = screen.getByRole('dialog', { name: 'Laura' });
    expect(within(dialog).getAllByRole('button', { name: 'Cerrar' })).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Cerrar' }).className).toContain('xp-modal-close');
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog', { name: 'Laura' })).toBeNull();
  });

  it('la ficha muestra la descripción COMPLETA y el detalle (la lista sigue con la breve)', async () => {
    const user = userEvent.setup();
    const long = 'Corte personalizado con asesoría de imagen. '.repeat(6).trim();
    vi.mocked(publicApi.profile).mockResolvedValue(base);
    vi.mocked(publicApi.catalog).mockResolvedValue({
      services: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Corte', category: 'Cabello', description: 'Corte a tu medida', fullDescription: long, detail: 'Incluye lavado.\nDuración aproximada: 45 min.', price: 35000, durationMinutes: 45, image: null, images: [], variants: [] }],
      packages: [],
      products: [],
    });
    vi.mocked(publicApi.team).mockResolvedValue([]);
    vi.mocked(publicApi.reviews).mockResolvedValue([]);
    render(<ProfilePage slug="mi-barberia" language="es" />);
    expect(await screen.findByText('Corte a tu medida')).toBeTruthy(); // la lista: la breve
    await user.click(screen.getByRole('button', { name: 'Ver detalle de Corte' }));
    const dialog = await screen.findByRole('dialog', { name: 'Corte' });
    expect(within(dialog).getByText(long)).toBeTruthy();
    expect(dialog.textContent).toContain('Duración aproximada: 45 min.');
  });
});
