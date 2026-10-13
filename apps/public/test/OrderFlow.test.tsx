import type { PublicBookingCatalog, PublicBookingProfile, PublicProductOrderDto } from '@xiro/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, publicApi } from '../src/api';
import { BookingFlow, type InitialChoice } from '../src/booking/BookingFlow';

import type * as ApiModule from '../src/api';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, publicApi: { ...actual.publicApi, availability: vi.fn(), days: vi.fn(), book: vi.fn(), order: vi.fn() } };
});

/**
 * Fase 1 del plan: pedir SOLO productos desde la página de reservas (sin profesional ni horario), para todo negocio que lo
 * active, sin cambiar el flujo de las citas.
 */
const SERVICE = '11111111-1111-4111-8111-111111111111';
const SHAMPOO = '33333333-3333-4333-8333-333333333333';
const CERA = '44444444-4444-4444-8444-444444444444';

const profile: PublicBookingProfile = {
  slug: 'mi-tienda',
  name: 'Mi Tienda',
  tagline: '',
  description: '',
  conditions: '',
  privacyPolicy: '',
  address: 'Calle 1 # 2-3',
  city: 'Bogotá',
  country: 'Colombia',
  phone: null,
  whatsapp: '573001112233',
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
  acceptsProductOrders: true,
  rating: { average: null, count: 0 },
  rules: { slotIntervalMinutes: 30, maxDaysAhead: 60, cancelUntilHours: 2, maxModifications: 2, requireEmail: false, customFields: [] },
  captchaSiteKey: null,
  accentColor: null,
  bookingTitle: '',
  trustBadges: [],
  features: { waitlist: false, discountCodes: false, rememberCustomer: false },
};

const products: PublicBookingCatalog['products'] = [
  { id: SHAMPOO, name: 'Shampoo', description: '', price: 15000, image: null, images: [], inStock: true },
  { id: CERA, name: 'Cera', description: '', price: 22000, image: null, images: [], inStock: true },
];
const withServices: PublicBookingCatalog = { services: [{ id: SERVICE, name: 'Corte', category: 'Servicios', description: '', price: 30000, durationMinutes: 60, image: null, images: [], variants: [] }], packages: [], products };
const onlyProducts: PublicBookingCatalog = { services: [], packages: [], products };

const order = vi.mocked(publicApi.order);
const book = vi.mocked(publicApi.book);

const orderFixture: PublicProductOrderDto = {
  id: '55555555-5555-4555-8555-555555555555',
  status: 'pending',
  items: [
    { id: 'l1', itemId: SHAMPOO, name: 'Shampoo', unitPrice: 15000, quantity: 2 },
    { id: 'l2', itemId: CERA, name: 'Cera', unitPrice: 22000, quantity: 1 },
  ],
  totalPrice: 52000,
  createdAt: '2026-10-12T15:00:00.000Z',
  discount: null,
  business: { name: 'Mi Tienda', slug: 'mi-tienda', currency: 'COP', whatsapp: '573001112233', address: 'Calle 1 # 2-3', city: 'Bogotá', location: null },
};

function renderFlow(over: Partial<PublicBookingProfile> = {}, catalog: PublicBookingCatalog = withServices, initial?: InitialChoice) {
  vi.resetAllMocks();
  vi.mocked(publicApi.days).mockResolvedValue([]);
  vi.mocked(publicApi.availability).mockResolvedValue({ date: '2026-10-06', timezone: 'America/Bogota', intervalMinutes: 30, totalMinutes: 60, slots: [] });
  render(<BookingFlow slug="mi-tienda" profile={{ ...profile, ...over }} catalog={catalog} team={[]} language="es" initial={initial} onClose={vi.fn()} />);
}

type User = ReturnType<typeof userEvent.setup>;
const next = (user: User) => user.click(screen.getByRole('button', { name: 'Continuar' }));
const plus = (user: User, name: string) => user.click(screen.getByRole('button', { name: `+ ${name}` }));
const minus = (user: User, name: string) => user.click(screen.getByRole('button', { name: `− ${name}` }));
async function fillDetails(user: User) {
  await user.type(screen.getByLabelText(/Nombre \*/), 'Laura');
  await user.type(screen.getByLabelText(/Apellido \*/), 'Gómez');
  await user.type(screen.getByLabelText(/Celular \*/), '3001234567');
  await next(user);
}
const accept = (user: User) => user.click(screen.getByLabelText('Acepto las condiciones de reserva y el tratamiento de mis datos personales.'));

describe('pedido de solo productos', () => {
  it('caso B: solo productos → sin profesional ni horario (3 pasos), resumen de pedido y "Confirmar pedido"', async () => {
    const user = userEvent.setup();
    renderFlow();
    order.mockResolvedValue({ order: orderFixture });
    await plus(user, 'Shampoo');
    await plus(user, 'Shampoo');
    await plus(user, 'Cera');
    // La barra muestra lo elegido (antes decía "Aún no has elegido nada" con productos marcados) y no "0 min".
    const bar = screen.getByLabelText('Revisa tu reserva');
    expect(bar.textContent).toContain('Shampoo ×2');
    expect(bar.textContent).toContain('Cera');
    expect(bar.textContent).toContain('$52.000');
    expect(bar.textContent).not.toContain('0 min');
    expect(screen.getByText('Paso 1 de 3 · Servicio')).toBeTruthy();
    expect(screen.getByText(/Solo productos: no necesitas cita/)).toBeTruthy();

    await next(user);
    expect(screen.getByText('Paso 2 de 3 · Tus datos')).toBeTruthy(); // directo a "Tus datos": sin profesional ni horario
    await fillDetails(user);
    expect(screen.getByText('Revisa tu pedido')).toBeTruthy();
    expect(screen.getByText('Recoges y pagas en el local')).toBeTruthy();
    expect(screen.queryByText('Profesional')).toBeNull();
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(book).not.toHaveBeenCalled();
    expect(order).toHaveBeenCalledTimes(1);
    const [slug, body] = order.mock.calls[0]!;
    expect(slug).toBe('mi-tienda');
    expect(body).toMatchObject({
      products: expect.arrayContaining([
        { itemId: SHAMPOO, quantity: 2 },
        { itemId: CERA, quantity: 1 },
      ]),
      customer: { firstName: 'Laura', lastName: 'Gómez', phone: '573001234567' }, // normalizado, igual que en las citas
      acceptTerms: true,
      website: '',
    });
    expect(JSON.stringify(body)).not.toMatch(/price|total|startsAt|professionalId/); // el precio lo pone el servidor

    // Pantalla final: total, que se recoge en el local y el mensaje de WhatsApp al negocio con el formato pedido.
    expect(await screen.findByText('¡Recibimos tu pedido!')).toBeTruthy();
    expect(screen.getAllByText('$52.000').length).toBeGreaterThan(0);
    const whatsapp = screen.getByRole('link', { name: /Enviar pedido por WhatsApp/ }).getAttribute('href')!;
    expect(whatsapp).toContain('https://wa.me/573001112233?text=');
    const text = decodeURIComponent(whatsapp.split('?text=')[1]!);
    expect(text).toContain('¡Hola Mi Tienda! 👋 Deseo comprar el/los siguiente(s) producto(s):');
    expect(text).toContain('• 2x Shampoo - $30.000');
    expect(text).toContain('• 1x Cera - $22.000');
    expect(text).toContain('Total a pagar: $52.000');
    expect(text).toContain('Mis datos: Laura Gómez | Tel: 3001234567');
  });

  it('sin WhatsApp configurado no muestra ese botón (el pedido igual queda registrado en la plataforma)', async () => {
    const user = userEvent.setup();
    renderFlow({ whatsapp: null });
    order.mockResolvedValue({ order: { ...orderFixture, business: { ...orderFixture.business, whatsapp: null } } });
    await plus(user, 'Shampoo');
    await next(user);
    await fillDetails(user);
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect(await screen.findByText('¡Recibimos tu pedido!')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
  });

  it('caso C: con un servicio vuelve a ser una cita (profesional/horario y "Confirmar reserva"), sin perder los productos', async () => {
    const user = userEvent.setup();
    renderFlow();
    await plus(user, 'Shampoo');
    expect(screen.getByText('Paso 1 de 3 · Servicio')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
    expect(screen.getByText('Paso 1 de 4 · Servicio')).toBeTruthy(); // vuelve el paso de horario
    expect(screen.queryByText(/Solo productos: no necesitas cita/)).toBeNull();
    expect(screen.getByLabelText('Revisa tu reserva').textContent).toContain('Shampoo');
    await next(user);
    expect(screen.getByText('Paso 2 de 4 · Fecha y hora')).toBeTruthy();
  });

  it('quitar todo y volver a elegir: sin nada no deja seguir; al volver a elegir sí', async () => {
    const user = userEvent.setup();
    renderFlow();
    await plus(user, 'Shampoo');
    await minus(user, 'Shampoo');
    expect(screen.getByText('Aún no has elegido nada')).toBeTruthy();
    await next(user);
    expect(screen.getByRole('alert').textContent).toBe('Elige al menos un servicio o un producto.');
    await plus(user, 'Cera');
    await next(user);
    expect(screen.getByText('Paso 2 de 3 · Tus datos')).toBeTruthy();
  });

  it('producto agotado al confirmar: vuelve a la selección diciendo cuál, y el reintento usa la MISMA clave (sin pedidos dobles)', async () => {
    const user = userEvent.setup();
    renderFlow();
    order.mockRejectedValueOnce(new ApiError(409, 'out_of_stock', [], { itemIds: [CERA] }));
    await plus(user, 'Cera');
    await next(user);
    await fillDetails(user);
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Algunos productos ya no están disponibles: Cera');
    expect(screen.getByText('Paso 1 de 3 · Servicio')).toBeTruthy();

    // Doble clic / reintento sin cambiar nada: misma clave de idempotencia.
    order.mockRejectedValueOnce(new ApiError(0, 'network_error'));
    order.mockResolvedValueOnce({ order: orderFixture });
    await next(user);
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    const keys = order.mock.calls.map(([, body]) => (body as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('negocio que NO acepta pedidos: solo productos no avanza y explica que deben ir con un servicio', async () => {
    const user = userEvent.setup();
    renderFlow({ acceptsProductOrders: false });
    await plus(user, 'Shampoo');
    expect(screen.getByText('Paso 1 de 4 · Servicio')).toBeTruthy(); // el flujo de cita de siempre
    await next(user);
    expect(screen.getByRole('alert').textContent).toBe('Para llevar productos, agrega también un servicio a tu cita.');
    expect(order).not.toHaveBeenCalled();
  });

  it('negocio sin servicios (solo productos): la pista habla de productos y el pedido funciona desde el detalle de un producto', async () => {
    renderFlow({ acceptsBookings: false }, onlyProducts, { productId: SHAMPOO });
    expect(screen.getByText(/Elige los productos que quieres llevar/)).toBeTruthy();
    expect(screen.getByText('Paso 1 de 3 · Servicio')).toBeTruthy();
    expect(screen.getByLabelText('Revisa tu reserva').textContent).toContain('Shampoo');
  });
});
