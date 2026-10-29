import { brandAccent, type PublicBookingCatalog, type PublicBookingProfile } from '@xiro/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { publicApi } from '../src/api';
import { BookingFlow } from '../src/booking/BookingFlow';
import { applyBrand } from '../src/lib/brand';

import type * as ApiModule from '../src/api';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, publicApi: { ...actual.publicApi, availability: vi.fn(), days: vi.fn(), book: vi.fn(), order: vi.fn() } };
});

/** Fase 3 del plan: rediseño "Atelier" — solo presentación, con la marca de cada negocio. */
const SERVICE = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '33333333-3333-4333-8333-333333333333';

const profile: PublicBookingProfile = {
  slug: 'luna',
  name: 'Estudio Luna',
  tagline: '',
  description: '',
  conditions: '',
  privacyPolicy: '',
  address: 'Calle 1',
  city: 'Bogotá',
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
  sections: { services: true, products: true, team: true, reviews: true, gallery: true, map: true },
  hours: [],
  openNow: true,
  openStatus: { open: true, changesAt: null },
  acceptsBookings: true,
  acceptsProductOrders: false,
  rating: { average: 4.8, count: 12 },
  rules: { slotIntervalMinutes: 30, maxDaysAhead: 60, cancelUntilHours: 2, maxModifications: 2, requireEmail: false, customFields: [] },
  captchaSiteKey: null,
  accentColor: null,
  bookingTitle: '',
  trustBadges: [],
  features: { waitlist: false, discountCodes: false, rememberCustomer: false, noPrepayBadge: false, customerNotes: true }, businessType: 'barbershop',
};
const catalog: PublicBookingCatalog = {
  services: [{ id: SERVICE, name: 'Corte', category: 'Cabello', description: 'Con lavado', price: 30000, durationMinutes: 60, image: null, images: [], variants: [] }],
  packages: [],
  products: [{ id: PRODUCT, name: 'Shampoo', description: 'Hidratante', price: 15000, image: null, images: [], inStock: true }],
};

function renderFlow(over: Partial<PublicBookingProfile> = {}) {
  vi.resetAllMocks();
  vi.mocked(publicApi.days).mockResolvedValue([]);
  vi.mocked(publicApi.availability).mockResolvedValue({ date: '2026-10-13', timezone: 'America/Bogota', intervalMinutes: 30, totalMinutes: 60, slots: [] });
  render(<BookingFlow slug="luna" profile={{ ...profile, ...over }} catalog={catalog} team={[]} language="es" onClose={vi.fn()} />);
}

describe('rediseño Atelier: marca y textos de cada negocio', () => {
  it('título por defecto neutro ("Reserva tu experiencia") o el del negocio', () => {
    renderFlow();
    expect(screen.getByText('Reserva tu experiencia')).toBeTruthy();
    document.body.innerHTML = '';
    renderFlow({ bookingTitle: 'Tu momento de calma' });
    expect(screen.getByText('Tu momento de calma')).toBeTruthy();
    expect(screen.queryByText('Reserva tu experiencia')).toBeNull();
  });

  it('avisos de confianza: solo los que el negocio configuró (ninguno por defecto)', () => {
    renderFlow();
    expect(screen.queryByText('Sin pago anticipado')).toBeNull();
    document.body.innerHTML = '';
    renderFlow({ trustBadges: ['Sin pago anticipado'] });
    expect(screen.getByText('Sin pago anticipado')).toBeTruthy();
  });

  it('el resumen muestra el negocio (nombre, valoración, dirección) desde su configuración', () => {
    renderFlow();
    const summary = screen.getByRole('complementary', { name: 'Tu cita' });
    expect(within(summary).getByText('Estudio Luna')).toBeTruthy();
    expect(within(summary).getByText('Calle 1, Bogotá')).toBeTruthy();
  });

  it('applyBrand fija los tonos del negocio para claro y oscuro (contraste garantizado) y los quita al volver al dorado', () => {
    const root = document.createElement('div');
    applyBrand('#1f4e79', root);
    const tokens = brandAccent('#1f4e79');
    expect(root.style.getPropertyValue('--bl-accent')).toBe(tokens.light.accent);
    expect(root.style.getPropertyValue('--bd-accent-text')).toBe(tokens.dark.accentText);
    applyBrand(null, root);
    expect(root.style.getPropertyValue('--bl-accent')).toBe('');
  });
});

describe('rediseño Atelier: acordeón y nuevas ayudas, sin perder nada', () => {
  it('un paso hecho queda plegado con su resumen; "Cambiar" vuelve a él sin perder lo elegido', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Paso 2 de 4 · Fecha y hora')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cambiar: Servicio' }));
    expect(screen.getByText('Paso 1 de 4 · Servicio')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /Corte/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('pastillas de días: elegir otro día pide los horarios de ESE día', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    const pills = within(await screen.findByRole('radiogroup', { name: 'Elige el día y la hora' })).getAllByRole('radio');
    expect(pills.length).toBeGreaterThan(5);
    await user.click(pills[2]!);
    const lastCall = vi.mocked(publicApi.availability).mock.calls.at(-1)!;
    expect(pills[2]!.getAttribute('aria-checked')).toBe('true');
    expect(lastCall[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // El calendario completo sigue disponible para fechas más lejanas.
    await user.click(screen.getByRole('button', { name: /Más fechas/ }));
    expect(screen.getByRole('button', { name: /Ocultar calendario/ })).toBeTruthy();
  });

  it('"Ver detalle" de un producto abre su información completa y "Agregar" lo suma al pedido de la cita', async () => {
    const user = userEvent.setup();
    renderFlow();
    expect(screen.getByRole('heading', { name: 'Servicios' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Para llevar/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ver detalle de Shampoo' }));
    const dialog = screen.getByRole('dialog', { name: 'Shampoo' });
    expect(within(dialog).getByText('Hidratante')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Agregar|Reservar/ }));
    expect(screen.queryByRole('dialog', { name: 'Shampoo' })).toBeNull();
    expect(screen.getByLabelText('Revisa tu reserva').textContent).toContain('Shampoo');
  });
});
