import type { AvailabilitySlot, ClientAccountDto, ClientBirthdayDto, PublicAppointmentDto, PublicBookingCatalog, PublicBookingProfile } from '@xiro/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, publicApi } from '../src/api';
import { BookingFlow } from '../src/booking/BookingFlow';

import type * as ApiModule from '../src/api';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, publicApi: { ...actual.publicApi, availability: vi.fn(), days: vi.fn(), book: vi.fn(), discount: vi.fn(), joinWaitlist: vi.fn(), accountBirthday: vi.fn() } };
});

/** Regalo de cumpleaños en la página pública: solo con sesión y programa activo; el servidor valida y calcula el descuento. */
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
  discount: { code: '', amount: 6000, birthday: true },
};
const nine = { time: '09:00', startsAt: '2026-10-06T14:00:00.000Z', state: 'available' as const };

type User = ReturnType<typeof userEvent.setup>;
const next = (user: User) => user.click(screen.getByRole('button', { name: 'Continuar' }));

const account: ClientAccountDto = { id: 'acc1', name: 'Laura Gómez', phone: '573001234567', email: null, photoUrl: null, mustChangePassword: false, birthDate: '1992-10-18' };
const gift = (patch: Record<string, unknown> = {}): ClientBirthdayDto => ({ active: true, hasBirthDate: true, validDays: 7, message: '', currency: 'COP', reward: { id: 'r1', year: 2026, startsOn: '2026-10-18', endsOn: '2026-10-24', state: 'available', rewardKind: 'percent', rewardValue: 20, scope: 'all', minTotal: 0, combinable: false, amount: null, usedAt: null, ...patch } });

function renderFlow(features: Partial<PublicBookingProfile['features']> = {}, slots: AvailabilitySlot[] = [nine], withAccount: ClientAccountDto | null = account) {
  vi.mocked(publicApi.days).mockResolvedValue([]);
  vi.mocked(publicApi.availability).mockResolvedValue({ date: '2026-10-06', timezone: 'America/Bogota', intervalMinutes: 30, totalMinutes: 60, slots });
  return render(<BookingFlow slug="mi-barberia" profile={{ ...profile, features: { ...profile.features, ...features } }} catalog={catalog} team={[]} language="es" account={withAccount} onClose={vi.fn()} />);
}
async function toDetails(user: User) {
  await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
  await next(user);
  await user.click(await screen.findByRole('radio', { name: '9:00 a. m.' }));
  await next(user);
}
const accept = (user: User) => user.click(screen.getByLabelText('Acepto las condiciones de reserva y el tratamiento de mis datos personales.'));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
});

describe('regalo de cumpleaños al reservar', () => {
  it('sin sesión no se consulta ni se ofrece', async () => {
    const user = userEvent.setup();
    renderFlow({}, [nine], null);
    await toDetails(user);
    await user.type(screen.getByLabelText(/Nombre \*/), 'Laura');
    await user.type(screen.getByLabelText(/Apellido \*/), 'Gómez');
    await user.type(screen.getByLabelText(/Celular \*/), '3001234567');
    await next(user);
    expect(vi.mocked(publicApi.accountBirthday)).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox', { name: /regalo de cumpleaños/ })).toBeNull();
  });

  it('programa apagado o regalo ya usado: no se ofrece', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.accountBirthday).mockResolvedValue(gift({ state: 'claimed' }));
    renderFlow();
    await toDetails(user);
    await next(user);
    expect(screen.queryByRole('checkbox', { name: /regalo de cumpleaños/ })).toBeNull();
  });

  it('con regalo disponible: se marca, muestra el ahorro y viaja como useBirthdayReward (el monto lo pone el servidor)', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.accountBirthday).mockResolvedValue(gift());
    vi.mocked(publicApi.book).mockResolvedValue({ appointment, token: 'x'.repeat(43) });
    renderFlow();
    await toDetails(user);
    await next(user);
    const box = await screen.findByRole('checkbox', { name: /Usar mi regalo de cumpleaños/ });
    expect(screen.getByText(/Ahorras \$6\.000/)).toBeTruthy();
    await user.click(box);
    expect(screen.getByText('Regalo de cumpleaños')).toBeTruthy();
    expect(screen.getAllByText('$24.000').length).toBeGreaterThan(0);
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    await waitFor(() => expect(vi.mocked(publicApi.book)).toHaveBeenCalled());
    const sent = vi.mocked(publicApi.book).mock.calls[0]![1];
    expect(sent).toMatchObject({ useBirthdayReward: true });
    expect(sent).not.toHaveProperty('birthdayAmount');
    expect(await screen.findByText('Regalo de cumpleaños')).toBeTruthy();
  });

  it('sin marcar no se envía', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.accountBirthday).mockResolvedValue(gift());
    vi.mocked(publicApi.book).mockResolvedValue({ appointment: { ...appointment, discount: null }, token: 'x'.repeat(43) });
    renderFlow();
    await toDetails(user);
    await next(user);
    await screen.findByRole('checkbox', { name: /Usar mi regalo de cumpleaños/ });
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    await waitFor(() => expect(vi.mocked(publicApi.book)).toHaveBeenCalled());
    expect(vi.mocked(publicApi.book).mock.calls[0]![1]).not.toHaveProperty('useBirthdayReward');
  });

  it('si el servidor lo rechaza (ya usado en otra compra) se explica, se desmarca y no se crea nada', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.accountBirthday).mockResolvedValue(gift());
    vi.mocked(publicApi.book).mockRejectedValue(new ApiError(409, 'birthday_reward_unavailable'));
    renderFlow();
    await toDetails(user);
    await next(user);
    const box = await screen.findByRole('checkbox', { name: /Usar mi regalo de cumpleaños/ });
    await user.click(box);
    await accept(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    expect(await screen.findByText(/recompensa de cumpleaños/i)).toBeTruthy();
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it('no combinable: con un código aplicado queda bloqueado', async () => {
    const user = userEvent.setup();
    vi.mocked(publicApi.accountBirthday).mockResolvedValue(gift());
    vi.mocked(publicApi.discount).mockResolvedValue({ code: 'DIEZ', description: '', kind: 'percent', value: 10, minTotal: 0 });
    renderFlow({ discountCodes: true });
    await toDetails(user);
    await next(user);
    await user.click(screen.getByRole('button', { name: /código de descuento/ }));
    await user.type(screen.getByLabelText('Código de descuento'), 'diez');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText(/Ahorras \$3\.000/);
    const box = screen.getByRole('checkbox', { name: /Usar mi regalo de cumpleaños/ });
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/no se puede sumar a otro descuento/)).toBeTruthy();
  });
});
