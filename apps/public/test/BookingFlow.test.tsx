import type { PublicAppointmentDto, PublicBookingCatalog, PublicBookingProfile } from '@xiro/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, publicApi } from '../src/api';
import { BookingFlow, type InitialChoice } from '../src/booking/BookingFlow';
import { downloadTextFile } from '../src/lib/ics';

import type * as ApiModule from '../src/api';
import type * as IcsModule from '../src/lib/ics';

vi.mock('../src/lib/ics', async (importOriginal) => {
  const actual = await importOriginal<typeof IcsModule>();
  return { ...actual, downloadTextFile: vi.fn() };
});

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, publicApi: { ...actual.publicApi, availability: vi.fn(), days: vi.fn(), book: vi.fn() } };
});

const profile: PublicBookingProfile = {
  slug: 'mi-barberia',
  name: 'Mi Barbería',
  tagline: '',
  description: '',
  conditions: 'Llega 5 minutos antes.',
  privacyPolicy: 'No compartimos tus datos.',
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
  rules: { slotIntervalMinutes: 30, maxDaysAhead: 60, cancelUntilHours: 2, maxModifications: 2, requireEmail: true, customFields: [] },
  captchaSiteKey: null,
};

const catalog: PublicBookingCatalog = {
  services: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Corte', category: 'Servicios', description: '', price: 30000, durationMinutes: 60, image: null, images: [], variants: [] }],
  packages: [],
  products: [],
};

const appointmentFixture: PublicAppointmentDto = {
  status: 'confirmed',
  startsAt: '2026-10-06T14:00:00.000Z',
  endsAt: '2026-10-06T15:00:00.000Z',
  durationMinutes: 60,
  totalPrice: 30000,
  professionalName: 'Ana',
  items: [{ id: 'i1', kind: 'service', itemId: '11111111-1111-4111-8111-111111111111', variantId: null, packageId: null, name: 'Corte', price: 30000, durationMinutes: 60, quantity: 1 }],
  business: { name: 'Mi Barbería', slug: 'mi-barberia', address: '', city: '', phone: null, whatsapp: null, timezone: 'America/Bogota', currency: 'COP', location: null },
  canCancel: true,
  canReschedule: true,
  modificationsLeft: 2,
  changeableUntil: '2026-10-06T12:00:00.000Z',
  canReview: false,
};

const days = vi.mocked(publicApi.days);
const availability = vi.mocked(publicApi.availability);
const book = vi.mocked(publicApi.book);
const download = vi.mocked(downloadTextFile);

const nine = { time: '09:00', startsAt: '2026-10-06T14:00:00.000Z', state: 'available' as const };
const ten = { time: '10:00', startsAt: '2026-10-06T15:00:00.000Z', state: 'available' as const };
const team = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Ana', bio: 'Colorista', photoUrl: null, serviceIds: [] }];

function renderFlow(over: Partial<PublicBookingProfile> = {}, options: { team?: typeof team; initial?: InitialChoice } = {}) {
  vi.resetAllMocks();
  days.mockResolvedValue([]);
  availability.mockResolvedValue({ date: '2026-10-06', timezone: 'America/Bogota', intervalMinutes: 30, totalMinutes: 60, slots: [nine, ten] });
  const onClose = vi.fn();
  render(<BookingFlow slug="mi-barberia" profile={{ ...profile, ...over }} catalog={catalog} team={options.team ?? []} language="es" initial={options.initial} onClose={onClose} />);
  return { onClose };
}

type User = ReturnType<typeof userEvent.setup>;
const next = (user: User) => user.click(screen.getByRole('button', { name: 'Continuar' }));

async function pickService(user: User) {
  await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
  await next(user);
}
async function pickSlot(user: User, name = '9:00 a.\u00a0m.') {
  await user.click(await screen.findByRole('radio', { name }));
  await next(user);
}
async function fillDetails(user: User, email = 'laura@correo.com') {
  await user.type(screen.getByLabelText(/Nombre \*/), 'Laura');
  await user.type(screen.getByLabelText(/Apellido \*/), 'Gómez');
  await user.type(screen.getByLabelText(/Celular \*/), '3001234567');
  if (email) await user.type(screen.getByLabelText(/Correo/), email);
  await next(user);
}
async function goToReview(user: User, email?: string) {
  await pickService(user);
  await pickSlot(user);
  await fillDetails(user, email);
}
const accept = (user: User) => user.click(screen.getByLabelText('Acepto las condiciones de reserva y el tratamiento de mis datos personales.'));
const confirm = (user: User) => user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));

describe('BookingFlow', () => {
  it('no deja avanzar del primer paso sin elegir nada', async () => {
    const user = userEvent.setup();
    renderFlow();
    await next(user);
    expect(screen.getByRole('alert').textContent).toBe('Elige al menos un servicio o paquete.');
  });

  it('muestra el progreso con nombre y la selección siempre a la vista, con el precio como $30.000', async () => {
    const user = userEvent.setup();
    renderFlow();
    expect(screen.getByText('Paso 1 de 4 · Servicio')).toBeTruthy();
    expect(screen.getByText('Aún no has elegido nada')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /Corte/ }));
    const bar = screen.getByLabelText('Revisa tu reserva');
    expect(bar.textContent).toContain('Corte');
    expect(bar.textContent).toContain('$30.000');
    expect(bar.textContent).toContain('60 min');
  });

  it('con un servicio ya elegido desde la tarjeta, abre con él marcado', () => {
    renderFlow({}, { initial: { serviceId: '11111111-1111-4111-8111-111111111111' } });
    expect((screen.getByRole('checkbox', { name: /Corte/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('sin equipo visible salta directo de servicios a horario (sin paso "con quién")', async () => {
    const user = userEvent.setup();
    renderFlow();
    await pickService(user);
    expect(await screen.findByRole('radio', { name: '9:00 a.\u00a0m.' })).toBeTruthy();
    expect(screen.getByText('Paso 2 de 4 · Fecha y hora')).toBeTruthy();
  });

  it('con equipo visible ofrece "Cualquier profesional disponible" y a cada persona del equipo', async () => {
    const user = userEvent.setup();
    renderFlow({}, { team });
    await pickService(user);
    expect(screen.getByText('Paso 2 de 5 · Profesional')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Cualquier profesional disponible/ }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: /Ana/ }));
    await next(user);
    await screen.findByRole('radio', { name: '9:00 a.\u00a0m.' });
    expect(availability).toHaveBeenLastCalledWith('mi-barberia', expect.any(String), team[0]!.id, expect.anything());
  });

  it('"Volver" conserva lo elegido y un paso hecho se puede tocar en el progreso', async () => {
    const user = userEvent.setup();
    renderFlow();
    await pickService(user);
    await user.click(await screen.findByRole('radio', { name: '9:00 a.\u00a0m.' }));
    await user.click(screen.getByRole('button', { name: 'Volver' }));
    expect((screen.getByRole('checkbox', { name: /Corte/ }) as HTMLInputElement).checked).toBe(true);
    await next(user);
    expect((await screen.findByRole('radio', { name: '9:00 a.\u00a0m.' })).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: '1. Servicio' }));
    expect(screen.getByText('Paso 1 de 4 · Servicio')).toBeTruthy();
  });

  it('no deja seguir de "Fecha y hora" sin elegir horario', async () => {
    const user = userEvent.setup();
    renderFlow();
    await pickService(user);
    await screen.findByRole('radio', { name: '9:00 a.\u00a0m.' });
    await next(user);
    expect(screen.getByRole('alert').textContent).toBe('Elige un horario disponible.');
  });

  it('en "Tus datos" no deja seguir sin nombre, apellido ni un celular válido', async () => {
    const user = userEvent.setup();
    renderFlow();
    await pickService(user);
    await pickSlot(user);
    await next(user);
    expect(screen.getAllByText('Este campo es obligatorio.').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Ingresa un número de celular válido.')).toBeTruthy();
    expect(screen.getByText('Paso 3 de 4 · Tus datos')).toBeTruthy();
    expect(book).not.toHaveBeenCalled();
  });

  it('el correo siempre es opcional: sin escribirlo, la reserva avanza y se envía sin correo', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToReview(user, '');
    await accept(user);
    book.mockResolvedValue({ appointment: appointmentFixture, token: 'tok123' });
    await confirm(user);
    await waitFor(() => expect(book).toHaveBeenCalledOnce());
    expect(book.mock.calls[0]![1]).toMatchObject({ customer: { email: undefined } });
  });

  it('si se escribe un correo con formato inválido, sí avisa (el formato se valida aunque no sea obligatorio)', async () => {
    const user = userEvent.setup();
    renderFlow();
    await pickService(user);
    await pickSlot(user);
    await fillDetails(user, 'no-es-un-correo');
    expect(screen.getByText('Ingresa un correo válido.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar reserva' })).toBeNull();
  });

  it('el resumen final muestra servicio, profesional, total y las condiciones y la privacidad del negocio', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToReview(user);
    const summary = document.querySelector('.xp-summary')!;
    expect(summary.textContent).toContain('Corte');
    expect(summary.textContent).toContain('Cualquier profesional');
    expect(summary.textContent).toContain('$30.000');
    expect(summary.textContent).toContain('Laura Gómez');
    expect(screen.getByText('Llega 5 minutos antes.').closest('details')).toBeTruthy();
    expect(screen.getByText('No compartimos tus datos.').closest('details')).toBeTruthy();
  });

  it('no envía sin aceptar los términos', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToReview(user);
    await confirm(user);
    expect(book).not.toHaveBeenCalled();
    expect(screen.getByText('Debes aceptar los términos y la privacidad.')).toBeTruthy();
  });

  it('el campo trampa existe pero está oculto (nunca lo llena una persona)', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToReview(user);
    const trap = screen.getByLabelText('Website', { selector: 'input' }) as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('.xp-trap')).toBeTruthy();
  });

  it('un reintento de confirmar reutiliza la misma clave de idempotencia; si cambia el horario, es otra clave', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToReview(user);
    await accept(user);
    book.mockRejectedValueOnce(new ApiError(0, 'network'));
    await confirm(user);
    await waitFor(() => expect(book).toHaveBeenCalledOnce());
    book.mockRejectedValueOnce(new ApiError(0, 'network'));
    await confirm(user);
    await waitFor(() => expect(book).toHaveBeenCalledTimes(2));
    const first = (book.mock.calls[0]![1] as { idempotencyKey?: string }).idempotencyKey;
    const second = (book.mock.calls[1]![1] as { idempotencyKey?: string }).idempotencyKey;
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).toBe(first);

    // Otro horario = otra reserva: clave nueva.
    await user.click(screen.getByRole('button', { name: '2. Fecha y hora' }));
    await user.click(await screen.findByRole('radio', { name: '10:00 a.\u00a0m.' }));
    await next(user);
    await next(user); // los datos y la aceptación se conservan
    book.mockRejectedValueOnce(new ApiError(0, 'network'));
    await confirm(user);
    await waitFor(() => expect(book).toHaveBeenCalledTimes(3));
    expect((book.mock.calls[2]![1] as { idempotencyKey?: string }).idempotencyKey).not.toBe(first);
  });

  it('si el horario se acaba de ocupar, muestra las alternativas y vuelve al paso de horario', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToReview(user);
    await accept(user);
    book.mockRejectedValue(new ApiError(409, 'slot_taken', [], { alternatives: [{ time: '10:00', startsAt: '2026-10-06T15:00:00.000Z' }] }));
    await confirm(user);
    await screen.findByText('Ese horario ya se ocupó, elige otro.');
    expect(screen.getByText('Ese horario se acaba de ocupar. Horarios libres cercanos:')).toBeTruthy();
    expect(screen.getByRole('button', { name: '10:00' })).toBeTruthy();
    expect(await screen.findByRole('radio', { name: '9:00 a.\u00a0m.' })).toBeTruthy();
    expect(screen.getByText('Paso 2 de 4 · Fecha y hora')).toBeTruthy();
  });

  it('al confirmar muestra la pantalla final: total, calendario (.ics sin el enlace personal), WhatsApp y cómo llegar', async () => {
    const user = userEvent.setup();
    renderFlow();
    await goToReview(user);
    await accept(user);
    book.mockResolvedValue({
      appointment: { ...appointmentFixture, business: { ...appointmentFixture.business, whatsapp: '573001234567', location: { latitude: 4.65, longitude: -74.08, placeId: 'ChIJabc', address: 'Cra. 7 #71-21, Bogotá' } } },
      token: 'tok123',
    });
    await confirm(user);
    expect(await screen.findByRole('heading', { name: '¡Tu cita quedó confirmada!' })).toBeTruthy();
    expect(screen.getAllByText('$30.000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cra. 7 #71-21, Bogotá').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Cómo llegar/ }).getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=4.65,-74.08&destination_place_id=ChIJabc');
    expect(screen.getByRole('link', { name: /Escribir por WhatsApp/ }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/573001234567\?text=Hola/);

    await user.click(screen.getByRole('button', { name: /Agregar al calendario/ }));
    expect(download).toHaveBeenCalledOnce();
    const [fileName, ics] = download.mock.calls[0]!;
    expect(fileName).toBe('cita-mi-barberia.ics');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Corte — Mi Barbería');
    expect(ics).toContain('DTSTART:20261006T140000Z');
    expect(ics).not.toContain('tok123');
  });
});
