import type { AvailabilitySlot, PublicAppointmentDto, PublicBookingCatalog, PublicBookingProfile } from '@xiro/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, publicApi } from '../src/api';
import { BookingFlow } from '../src/booking/BookingFlow';
import { loadRememberedCustomer } from '../src/lib/rememberCustomer';
import { parseRoute, waitlistPath } from '../src/lib/route';

import type * as ApiModule from '../src/api';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, publicApi: { ...actual.publicApi, availability: vi.fn(), days: vi.fn(), book: vi.fn(), discount: vi.fn(), joinWaitlist: vi.fn() } };
});

/** Fase 4 del plan en la página pública: código de descuento, lista de espera y recordar datos (cada uno lo activa el negocio). */
const SERVICE = '11111111-1111-4111-8111-111111111111';
const profile: PublicBookingProfile = {
  slug: 'mi-barberia',
  name: 'Mi Barbería',
  tagline: '',
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
  sections: { services: true, products: true, team: true, reviews: true, gallery: true, map: true },
  hours: [],
  openNow: true,
  openStatus: { open: true, changesAt: '2026-10-06T00:00:00.000Z' },
  acceptsBookings: true,
  acceptsProductOrders: false,
  rating: { average: null, count: 0 },
  rules: { slotIntervalMinutes: 30, maxDaysAhead: 60, cancelUntilHours: 2, maxModifications: 2, requireEmail: false, customFields: [] },
  captchaSiteKey: null,
  accentColor: null,
  bookingTitle: '',
  trustBadges: [],
  features: { waitlist: false, discountCodes: false, rememberCustomer: false, noPrepayBadge: false, customerNotes: true }, businessType: 'barbershop',
};
const catalog: PublicBookingCatalog = {
  services: [{ id: SERVICE, name: 'Corte', category: 'Servicios', description: '', price: 30000, durationMinutes: 60, image: null, images: [], variants: [] }],
  packages: [],
  products: [],
};
const appointment: PublicAppointmentDto = {
  status: 'confirmed',
  startsAt: '2026-10-06T14:00:00.000Z',
  endsAt: '2026-10-06T15:00:00.000Z',
  durationMinutes: 60,
  totalPrice: 30000,
  professionalName: 'Ana',
  items: [{ id: 'i1', kind: 'service', itemId: SERVICE, variantId: null, packageId: null, name: 'Corte', price: 30000, durationMinutes: 60, quantity: 1 }],
  business: { name: 'Mi Barbería', slug: 'mi-barberia', address: '', city: '', phone: null, whatsapp: null, timezone: 'America/Bogota', currency: 'COP', location: null },
  canCancel: true,
  canReschedule: true,
  modificationsLeft: 2,
  changeableUntil: '2026-10-06T12:00:00.000Z',
  canReview: false,
  discount: { code: 'DIEZ', amount: 3000 },
};
const nine = { time: '09:00', startsAt: '2026-10-06T14:00:00.000Z', state: 'available' as const };
const booked = { time: '09:00', startsAt: '2026-10-06T14:00:00.000Z', state: 'booked' as const };

type User = ReturnType<typeof userEvent.setup>;
const next = (user: User) => user.click(screen.getByRole('button', { name: 'Continuar' }));

function renderFlow(features: Partial<PublicBookingProfile['features']> = {}, slots: AvailabilitySlot[] = [nine]) {
  vi.mocked(publicApi.days).mockResolvedValue([]);
  vi.mocked(publicApi.availability).mockResolvedValue({ date: '2026-10-06', timezone: 'America/Bogota', intervalMinutes: 30, totalMinutes: 60, slots });
  return render(<BookingFlow slug="mi-barberia" profile={{ ...profile, features: { ...profile.features, ...features } }} catalog={catalog} team={[]} language="es" onClose={vi.fn()} />);
}
async function toDetails(user: User) {
  await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
  await next(user);
  await user.click(await screen.findByRole('radio', { name: '9:00 a. m.' }));
  await next(user);
}
async function fillDetails(user: User) {
  await user.type(screen.getByLabelText(/Nombre \*/), 'Laura');
  await user.type(screen.getByLabelText(/Apellido \*/), 'Gómez');
  await user.type(screen.getByLabelText(/Celular \*/), '3001234567');
}
const accept = (user: User) => user.click(screen.getByLabelText('Acepto las condiciones de reserva y el tratamiento de mis datos personales.'));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
});

describe('código de descuento', () => {
  it('apagado: el resumen no ofrece el campo', async () => {
    const user = userEvent.setup();
    renderFlow();
    await toDetails(user);
    await fillDetails(user);
    await next(user);
    expect(screen.queryByRole('button', { name: /código de descuento/ })).toBeNull();
  });

  it('activo: se valida, muestra el ahorro y el total con descuento, y viaja al confirmar', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.discount).mockResolvedValue({ code: 'DIEZ', description: 'Bienvenida', kind: 'percent', value: 10, minTotal: 0 });
    vi.mocked(publicApi.book).mockResolvedValue({ appointment, token: 'x'.repeat(43) });
    renderFlow({ discountCodes: true });
    await toDetails(user);
    await fillDetails(user);
    await next(user);
    await user.click(screen.getByRole('button', { name: /código de descuento/ }));
    await user.type(screen.getByLabelText('Código de descuento'), 'diez');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(vi.mocked(publicApi.discount)).toHaveBeenCalledWith('mi-barberia', 'DIEZ');
    expect(await screen.findByText(/Ahorras \$3\.000/)).toBeTruthy();
    expect(screen.getByText('Descuento (DIEZ)')).toBeTruthy();
    expect(screen.getAllByText('$27.000').length).toBeGreaterThan(0);
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    await waitFor(() => expect(vi.mocked(publicApi.book)).toHaveBeenCalled());
    expect(vi.mocked(publicApi.book).mock.calls[0]![1]).toMatchObject({ discountCode: 'DIEZ' });
    // La confirmación también muestra el descuento.
    expect(await screen.findByText('Descuento (DIEZ)')).toBeTruthy();
  });

  it('el servidor lo rechaza al confirmar (se agotó): se dice por qué, se quita y no se crea nada', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.discount).mockResolvedValue({ code: 'ULTIMO', description: '', kind: 'fixed', value: 5000, minTotal: 0 });
    vi.mocked(publicApi.book).mockRejectedValue(new ApiError(409, 'discount_invalid'));
    renderFlow({ discountCodes: true });
    await toDetails(user);
    await fillDetails(user);
    await next(user);
    await user.click(screen.getByRole('button', { name: /código de descuento/ }));
    await user.type(screen.getByLabelText('Código de descuento'), 'ULTIMO');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText(/Ahorras/);
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    expect(await screen.findByText('Ese código no es válido, venció o ya se agotó.')).toBeTruthy();
    expect(screen.queryByText(/Ahorras/)).toBeNull();
  });

  it('compra mínima no alcanzada: lo dice con el monto y no lo aplica', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.discount).mockResolvedValue({ code: 'GRANDE', description: '', kind: 'percent', value: 20, minTotal: 100000 });
    renderFlow({ discountCodes: true });
    await toDetails(user);
    await fillDetails(user);
    await next(user);
    await user.click(screen.getByRole('button', { name: /código de descuento/ }));
    await user.type(screen.getByLabelText('Código de descuento'), 'GRANDE');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(await screen.findByText('Este código aplica en compras desde $100.000.')).toBeTruthy();
  });
});

describe('lista de espera', () => {
  it('día sin cupo y negocio con lista: ofrece anotarse y envía día, servicios y datos', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.joinWaitlist).mockResolvedValue({ entry: { date: '2026-10-06', status: 'waiting', services: ['Corte'], business: { name: 'Mi Barbería', slug: 'mi-barberia' } }, token: 't'.repeat(43), manageUrl: '' });
    renderFlow({ waitlist: true }, [booked]);
    await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Avisarme si se libera' }));
    const dialog = screen.getByRole('dialog', { name: 'Lista de espera' });
    await user.type(within(dialog).getByLabelText(/Nombre \*/), 'Laura');
    await user.type(within(dialog).getByLabelText(/Apellido \*/), 'Gómez');
    await user.type(within(dialog).getByLabelText(/Celular \*/), '3001234567');
    await user.click(within(dialog).getByRole('button', { name: 'Anotarme en la lista' }));
    expect(within(dialog).getByText('Debes aceptar los términos y la privacidad.')).toBeTruthy();
    expect(vi.mocked(publicApi.joinWaitlist)).not.toHaveBeenCalled();
    await user.click(within(dialog).getByLabelText(/avisarme si se libera un horario/));
    await user.click(within(dialog).getByRole('button', { name: 'Anotarme en la lista' }));
    await waitFor(() => expect(vi.mocked(publicApi.joinWaitlist)).toHaveBeenCalled());
    expect(vi.mocked(publicApi.joinWaitlist).mock.calls[0]![1]).toMatchObject({ services: [SERVICE], professionalId: 'any', customer: { firstName: 'Laura', phone: '573001234567' }, acceptTerms: true });
    expect(await screen.findByRole('link', { name: 'Ver mi lugar en la lista' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver mi lugar en la lista' }).getAttribute('href')).toBe(waitlistPath('mi-barberia', 't'.repeat(43)));
  });

  it('Esc en el modal cierra SOLO el modal: el flujo de reserva sigue abierto con lo elegido', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(publicApi.days).mockResolvedValue([]);
    vi.mocked(publicApi.availability).mockResolvedValue({ date: '2026-10-06', timezone: 'America/Bogota', intervalMinutes: 30, totalMinutes: 60, slots: [booked] });
    render(<BookingFlow slug="mi-barberia" profile={{ ...profile, features: { ...profile.features, waitlist: true } }} catalog={catalog} team={[]} language="es" onClose={onClose} />);
    await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Avisarme si se libera' }));
    expect(screen.getByRole('dialog', { name: 'Lista de espera' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Lista de espera' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Sin modal, Esc sí cierra el flujo (como siempre).
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('sin lista activada: el día lleno no la ofrece', async () => {
    const user = userEvent.setup();
    renderFlow({}, [booked]);
    await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
    await next(user);
    await screen.findByText(/no quedan horarios/);
    expect(screen.queryByRole('button', { name: 'Avisarme si se libera' })).toBeNull();
  });
});

describe('recordar mis datos', () => {
  it('marcado: tras reservar quedan en este dispositivo y la próxima vez el formulario viene lleno', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.book).mockResolvedValue({ appointment: { ...appointment, discount: null }, token: 'x'.repeat(43) });
    const first = renderFlow({ rememberCustomer: true });
    await toDetails(user);
    await fillDetails(user);
    await user.click(screen.getByLabelText(/Recordar mis datos/));
    await next(user);
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    await waitFor(() => expect(loadRememberedCustomer('mi-barberia')).toMatchObject({ firstName: 'Laura', lastName: 'Gómez', phone: '3001234567' }));
    first.unmount();
    renderFlow({ rememberCustomer: true });
    await toDetails(user);
    expect((screen.getByLabelText(/Nombre \*/) as HTMLInputElement).value).toBe('Laura');
    expect((screen.getByLabelText(/Recordar mis datos/) as HTMLInputElement).checked).toBe(true);
  });

  it('el negocio no lo ofrece: ni la casilla ni se guarda nada', async () => {
    const user = userEvent.setup();
    renderFlow();
    await toDetails(user);
    expect(screen.queryByLabelText(/Recordar mis datos/)).toBeNull();
    expect(loadRememberedCustomer('mi-barberia')).toBeNull();
  });
});

describe('rutas nuevas', () => {
  it('enlace de lista de espera y de reseña', () => {
    expect(parseRoute('/reservar/luna/espera/abc')).toEqual({ name: 'waitlist', slug: 'luna', token: 'abc' });
    expect(parseRoute('/reservar/luna/resena/id.firma')).toEqual({ name: 'review', slug: 'luna', token: 'id.firma' });
    expect(parseRoute('/reservar/luna/gestion/abc')).toEqual({ name: 'manage', slug: 'luna', token: 'abc' });
  });
});
