import type { PublicBookingCatalog, PublicBookingProfile } from '@xiro/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, publicApi } from '../src/api';
import { ProfilePage } from '../src/pages/ProfilePage';

import type * as ApiModule from '../src/api';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, publicApi: { ...actual.publicApi, profile: vi.fn(), catalog: vi.fn(), team: vi.fn(), reviews: vi.fn() } };
});

const profile = vi.mocked(publicApi.profile);
const catalog = vi.mocked(publicApi.catalog);
const team = vi.mocked(publicApi.team);
const reviews = vi.mocked(publicApi.reviews);

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
  sections: { services: true, products: false, team: false, reviews: false, gallery: false, map: false },
  hours: [],
  openNow: false,
  openStatus: { open: false, changesAt: '2026-10-06T14:00:00.000Z' },
  acceptsBookings: true,
  acceptsProductOrders: false,
  rating: { average: null, count: 0 },
  rules: { slotIntervalMinutes: 30, maxDaysAhead: 60, cancelUntilHours: 2, maxModifications: 2, requireEmail: true, customFields: [] },
  captchaSiteKey: null,
};

const emptyCatalog: PublicBookingCatalog = { services: [], packages: [], products: [] };

describe('ProfilePage', () => {
  const oneService: PublicBookingCatalog = {
    services: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Corte', category: 'Servicios', description: '', price: 35000, durationMinutes: 60, image: null, images: [], variants: [] },
      { id: '33333333-3333-4333-8333-333333333333', name: 'Barba', category: 'Servicios', description: '', price: 20000, durationMinutes: 30, image: null, images: [], variants: [] },
    ],
    packages: [],
    products: [],
  };

  it('muestra el nombre, la frase y el estado de apertura mientras carga el catálogo', async () => {
    profile.mockResolvedValue({ ...base, openStatus: { open: false, changesAt: null } });
    catalog.mockResolvedValue(emptyCatalog);
    render(<ProfilePage slug="mi-barberia" language="es" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi Barbería' })).toBeTruthy();
    expect(screen.getByText('Cortes con estilo')).toBeTruthy();
    expect(screen.getByText('Cerrado')).toBeTruthy();
  });

  it('abierto: dice hasta qué hora; cerrado: cuándo vuelve a abrir', async () => {
    profile.mockResolvedValue({ ...base, openStatus: { open: true, changesAt: '2026-10-06T00:00:00.000Z' } });
    catalog.mockResolvedValue(emptyCatalog);
    const { unmount } = render(<ProfilePage slug="mi-barberia" language="es" />);
    expect(await screen.findByText('Abierto · cierra a las 7:00 p. m.')).toBeTruthy();
    unmount();
    profile.mockResolvedValue({ ...base, openStatus: { open: false, changesAt: '2026-10-06T14:00:00.000Z' } });
    render(<ProfilePage slug="mi-barberia" language="es" />);
    expect(await screen.findByText(/^Cerrado · abre .+ a las 9:00 a\. m\.$/)).toBeTruthy();
  });

  it('un negocio inexistente o sin publicar muestra el mismo aviso, sin datos', async () => {
    profile.mockRejectedValue(new ApiError(404, 'not_found'));
    render(<ProfilePage slug="no-existe" language="es" />);
    expect(await screen.findByRole('heading', { name: 'Esta página no existe' })).toBeTruthy();
    expect(screen.getByText('Puede que la dirección esté mal escrita o que el negocio ya no tenga su página pública activa.')).toBeTruthy();
  });

  it('si el negocio no puede recibir reservas, no ofrece ningún botón de reservar y explica qué hacer', async () => {
    profile.mockResolvedValue({ ...base, acceptsBookings: false, whatsapp: '573001234567', phone: '573001234567' });
    catalog.mockResolvedValue(emptyCatalog);
    render(<ProfilePage slug="mi-barberia" language="es" />);
    await screen.findByRole('heading', { level: 1, name: 'Mi Barbería' });
    await waitFor(() => expect(catalog).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Reservar/ })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Las reservas en línea no están disponibles por ahora' })).toBeTruthy();
    const section = document.getElementById('servicios')!;
    expect(within(section).getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/573001234567/);
    expect(within(section).getByRole('link', { name: /Llamar/ }).getAttribute('href')).toBe('tel:+573001234567');
  });

  it('negocio que solo vende productos (sin citas en línea) pero acepta pedidos: ofrece "Pedir productos" y abre el pedido', async () => {
    const user = userEvent.setup();
    profile.mockResolvedValue({ ...base, acceptsBookings: false, acceptsProductOrders: true });
    catalog.mockResolvedValue({ services: [], packages: [], products: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Perfume', description: '', price: 80000, image: null, images: [], inStock: true }] });
    render(<ProfilePage slug="mi-barberia" language="es" />);
    await screen.findByRole('heading', { level: 1, name: 'Mi Barbería' });
    expect(screen.queryByRole('button', { name: 'Reservar cita' })).toBeNull();
    const cta = (await screen.findAllByRole('button', { name: 'Pedir productos' }))[0]!;
    await user.click(cta);
    expect(await screen.findByRole('dialog', { name: 'Reservar cita' })).toBeTruthy(); // aún sin nada elegido, el flujo de siempre
    expect(screen.getByText(/Elige los productos que quieres llevar/)).toBeTruthy();
  });

  it('enlace directo a un servicio (/reservar/:slug/articulo/:id): abre su detalle y al cerrarlo la dirección vuelve a la del negocio', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/reservar/mi-barberia/articulo/33333333-3333-4333-8333-333333333333');
    profile.mockResolvedValue(base);
    catalog.mockResolvedValue(oneService);
    render(<ProfilePage slug="mi-barberia" itemId="33333333-3333-4333-8333-333333333333" language="es" />);
    const detail = await screen.findByRole('dialog', { name: 'Barba' });
    expect(within(detail).getByRole('button', { name: /Reservar/ })).toBeTruthy();
    await user.click(within(detail).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog', { name: 'Barba' })).toBeNull();
    expect(window.location.pathname).toBe('/reservar/mi-barberia');
  });

  it('con servicios reservables ofrece "Reservar cita" arriba, fijo al bajar, y uno por servicio', async () => {
    profile.mockResolvedValue(base);
    catalog.mockResolvedValue(oneService);
    render(<ProfilePage slug="mi-barberia" language="es" />);
    await screen.findByText('Corte');
    expect(screen.getAllByRole('button', { name: 'Reservar cita', hidden: true }).length).toBeGreaterThanOrEqual(2); // encabezado + barra fija
    expect(screen.getByRole('button', { name: 'Reservar Corte' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reservar Barba' })).toBeTruthy();
    expect(screen.getByText('$35.000')).toBeTruthy();
  });

  it('el botón de una tarjeta abre el flujo con ese servicio ya elegido', async () => {
    profile.mockResolvedValue(base);
    catalog.mockResolvedValue(oneService);
    const user = userEvent.setup();
    render(<ProfilePage slug="mi-barberia" language="es" />);
    await user.click(await screen.findByRole('button', { name: 'Reservar Barba' }));
    const dialog = screen.getByRole('dialog', { name: 'Reservar cita' });
    expect((within(dialog).getByRole('checkbox', { name: /Barba/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole('checkbox', { name: /Corte/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('el botón del encabezado abre el flujo y Esc lo cierra', async () => {
    profile.mockResolvedValue(base);
    catalog.mockResolvedValue(oneService);
    const user = userEvent.setup();
    render(<ProfilePage slug="mi-barberia" language="es" />);
    await screen.findByText('Corte');
    await user.click(document.querySelector<HTMLButtonElement>('.xp-hero-cta button')!);
    expect(screen.getByRole('dialog', { name: 'Reservar cita' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('los horarios muestran los siete días de lunes a domingo y marcan los días cerrados', async () => {
    profile.mockResolvedValue({ ...base, hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, from: '09:00', to: '19:00' })) });
    catalog.mockResolvedValue(emptyCatalog);
    render(<ProfilePage slug="mi-barberia" language="es" />);
    const section = (await screen.findByRole('heading', { name: 'Horarios de atención' })).closest('section')!;
    const labels = [...section.querySelectorAll('dt')].map((dt) => dt.firstChild?.textContent);
    expect(labels).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
    expect(within(section).getAllByText('Cerrado')).toHaveLength(2);
    expect(within(section).getAllByText('9:00 a. m. – 7:00 p. m.')).toHaveLength(5);
  });

  it('la galería abre la foto en grande, navega con flechas y Esc la cierra', async () => {
    profile.mockResolvedValue({ ...base, sections: { ...base.sections, gallery: true }, gallery: ['/a.jpg', '/b.jpg'] });
    catalog.mockResolvedValue(emptyCatalog);
    const user = userEvent.setup();
    render(<ProfilePage slug="mi-barberia" language="es" />);
    await user.click(await screen.findByRole('button', { name: 'Ampliar foto 1 de 2' }));
    const dialog = screen.getByRole('dialog', { name: '1 de 2' });
    expect(dialog.querySelector('img')!.getAttribute('src')).toBe('/a.jpg');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog').querySelector('img')!.getAttribute('src')).toBe('/b.jpg');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cuando la dirección visitada es anterior, cambia la URL a la vigente sin recargar', async () => {
    profile.mockResolvedValue({ ...base, slug: 'nueva-direccion' });
    catalog.mockResolvedValue(emptyCatalog);
    const previousUrl = window.location.href;
    render(<ProfilePage slug="direccion-vieja" language="es" />);
    await screen.findByRole('heading', { level: 1, name: 'Mi Barbería' });
    await waitFor(() => expect(window.location.pathname).toBe('/reservar/nueva-direccion'));
    window.history.replaceState(null, '', previousUrl); // deja el entorno de pruebas como estaba
  });

  describe('ubicación', () => {
    const withPin: PublicBookingProfile = {
      ...base,
      latitude: 4.6533,
      longitude: -74.0836,
      mapAddress: 'Cra. 7 #71-21, Bogotá',
      placeId: 'ChIJ_lugar_de_prueba_123',
      mapImageUrl: '/api/public/booking/mi-barberia/map.png?v=4.6533,-74.0836',
      sections: { ...base.sections, map: true },
    };
    const open = async (data: PublicBookingProfile) => {
      profile.mockResolvedValue(data);
      catalog.mockResolvedValue(emptyCatalog);
      render(<ProfilePage slug="mi-barberia" language="es" />);
      await screen.findByRole('heading', { level: 1, name: 'Mi Barbería' });
    };

    it('con pin: mapa de solo lectura, dirección y los dos botones con los enlaces exactos', async () => {
      await open(withPin);
      const map = screen.getByRole('img', { name: 'Mapa con la ubicación de Mi Barbería' });
      expect(map.getAttribute('src')).toBe('/api/public/booking/mi-barberia/map.png?v=4.6533,-74.0836');
      expect(screen.getByText('Cra. 7 #71-21, Bogotá')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Abrir en Google Maps' }).getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=4.6533,-74.0836&destination_place_id=ChIJ_lugar_de_prueba_123');
      expect(screen.getByRole('link', { name: 'Abrir en Waze' }).getAttribute('href')).toBe('https://waze.com/ul?ll=4.6533,-74.0836&navigate=yes');
      for (const name of ['Abrir en Google Maps', 'Abrir en Waze']) expect(screen.getByRole('link', { name }).getAttribute('target')).toBe('_blank');
    });

    it('sin place_id el enlace de Google Maps solo lleva las coordenadas', async () => {
      await open({ ...withPin, placeId: null });
      expect(screen.getByRole('link', { name: 'Abrir en Google Maps' }).getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=4.6533,-74.0836');
    });

    it('sin imagen del mapa (el servidor no lo tiene configurado) quedan la dirección y los botones', async () => {
      await open({ ...withPin, mapImageUrl: null });
      expect(screen.queryByRole('img', { name: /Mapa con la ubicación/ })).toBeNull();
      expect(screen.getByText('Cra. 7 #71-21, Bogotá')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Abrir en Waze' })).toBeTruthy();
    });

    it('si la imagen no carga, se quita sin dejar un ícono roto y los botones siguen', async () => {
      await open(withPin);
      fireEvent.error(screen.getByRole('img', { name: /Mapa con la ubicación/ }));
      expect(screen.queryByRole('img', { name: /Mapa con la ubicación/ })).toBeNull();
      expect(screen.getByRole('link', { name: 'Abrir en Google Maps' })).toBeTruthy();
    });

    it('sin dirección del pin usa la del negocio', async () => {
      await open({ ...withPin, mapAddress: '', address: 'Calle 1 # 2-3', city: 'Cali' });
      expect(screen.getByText('Calle 1 # 2-3, Cali')).toBeTruthy();
    });

    it('solo con la dirección escrita: sin imagen de mapa, y "Cómo llegar" busca ese texto', async () => {
      await open({ ...base, address: 'Calle 1 # 2-3' });
      expect(screen.queryByRole('img', { name: /Mapa con la ubicación/ })).toBeNull();
      expect(screen.getByText('Calle 1 # 2-3')).toBeTruthy();
      const href = screen.getByRole('link', { name: 'Abrir en Google Maps' }).getAttribute('href')!;
      expect(href).toContain('google.com/maps/search');
      expect(decodeURIComponent(href)).toContain('Calle 1 # 2-3');
    });

    it('con pin pero sin ninguna dirección escrita: los botones de navegación se muestran igual, sin línea de dirección', async () => {
      await open({ ...withPin, mapAddress: '', address: '', city: '', mapImageUrl: null });
      expect(screen.getByRole('link', { name: 'Abrir en Google Maps' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Abrir en Waze' })).toBeTruthy();
      expect(document.querySelector('.xp-address')).toBeNull();
    });

    it('el teléfono se marca con indicativo aunque el dueño lo haya escrito sin él', async () => {
      await open({ ...withPin, phone: '300 123 4567' });
      expect(screen.getByRole('link', { name: /Llamar/ }).getAttribute('href')).toBe('tel:+573001234567');
    });

    it('sin dirección, pin ni contacto no se dibuja la sección de ubicación', async () => {
      await open(base);
      expect(screen.queryByRole('heading', { name: 'Ubicación y contacto' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Abrir en Waze' })).toBeNull();
    });
  });

  it('solo pide equipo y reseñas cuando la sección está activa en el negocio', async () => {
    profile.mockResolvedValue(base); // team y reviews desactivados
    catalog.mockResolvedValue(emptyCatalog);
    render(<ProfilePage slug="mi-barberia" language="es" />);
    await screen.findByRole('heading', { level: 1, name: 'Mi Barbería' });
    await waitFor(() => expect(catalog).toHaveBeenCalled());
    expect(team).not.toHaveBeenCalled();
    expect(reviews).not.toHaveBeenCalled();
  });
});
