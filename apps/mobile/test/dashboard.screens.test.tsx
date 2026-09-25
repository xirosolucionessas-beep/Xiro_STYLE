import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { DashboardView, type DashboardViewProps } from '../src/web/screens/Dashboard';
import { HeaderSearch, MessagesMenu, NotificationsMenu, ProfileMenu, type HeaderSearchProps, type NotificationRow } from '../src/web/shell/HeaderTools';
import { tw } from '../src/web/shell/strings';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

/* ---------- Tablero de Inicio ---------- */

function dashboard(overrides: Partial<DashboardViewProps> = {}) {
  const props: DashboardViewProps = {
    t,
    greeting: 'Buenos días',
    businessName: 'Studio Ana',
    userName: 'Ana Pérez',
    businessSlug: 'studio-ana',
    logo: <span data-testid="logo" />,
    heroUrl: null,
    onChangeLogo: vi.fn(),
    logoBusy: false,
    onEditProfile: vi.fn(),
    kpis: [
      { id: 'sales', icon: 'coins', label: 'Ventas hoy', value: '$ 120.000', trend: { direction: 'up', text: 'Subió 20% frente a ayer' } },
      { id: 'services', icon: 'scissors', label: 'Servicios hoy', value: '4', trend: { direction: 'down', text: 'Bajó 10% frente a ayer' } },
      { id: 'cash', icon: 'wallet', label: 'Saldo disponible', value: '—', hint: 'Caja sin abrir', onPress: vi.fn() },
    ],
    actions: [
      { id: 'catalog', icon: 'book-open', label: 'Catálogo', href: '/catalog' },
      { id: 'appointments', icon: 'calendar-days', label: 'Citas', soon: true },
    ],
    needsWhatsappSetup: false,
    onGoBusinessSettings: vi.fn(),
    summary: { loading: false, empty: false, rows: [{ id: 'count', label: 'Servicios realizados', value: '4' }] },
    stock: { loading: false, allHref: '/inventory?status=reorder', rows: [{ id: '1', name: 'Cera', badge: '3 uds', out: false, href: '/item/1' }] },
    activity: { loading: false, rows: [{ id: 'a1', icon: 'scissors', title: 'Servicio a Juan', detail: 'Corte', time: 'hace 5 min', amount: '$ 25.000' }] },
    onOpenAssistant: vi.fn(),
    navigate: vi.fn(),
    year: 2026,
    supportHref: 'https://wa.me/573000000000',
    ...overrides,
  };
  return { props, ...render(<DashboardView {...props} />) };
}

describe('DashboardView', () => {
  it('saluda con el nombre del negocio y muestra la marca', () => {
    dashboard();
    expect(screen.getByRole('heading', { level: 2, name: 'Buenos días, bienvenido a Studio Ana' })).toBeTruthy();
  });

  it('cada indicador dice en texto si subió o bajó frente a ayer (no solo color o flecha)', () => {
    dashboard();
    expect(screen.getByText('Subió 20% frente a ayer')).toBeTruthy();
    expect(screen.getByText('Bajó 10% frente a ayer')).toBeTruthy();
  });

  it('la caja es un botón que actúa y sin caja abierta lo dice', async () => {
    const { props } = dashboard();
    await userEvent.click(screen.getByRole('button', { name: /Saldo disponible/ }));
    expect(props.kpis[2]!.onPress).toHaveBeenCalled();
    expect(screen.getByText('Caja sin abrir')).toBeTruthy();
  });

  it('las citas no existen todavía: dice "Próximamente" en lugar de inventar datos', () => {
    dashboard();
    const panel = screen.getByRole('heading', { name: 'Próximas citas' }).closest('section')!;
    expect(within(panel).getByText('Próximamente')).toBeTruthy();
  });

  it('inventario sin faltantes se declara en orden; con faltantes enlaza al producto', async () => {
    const first = dashboard();
    expect(screen.getByRole('link', { name: /Cera/ }).getAttribute('href')).toBe('/item/1');
    await userEvent.click(screen.getByRole('link', { name: /Cera/ }));
    expect(first.props.navigate).toHaveBeenCalledWith('/item/1');
    first.unmount();
    dashboard({ stock: { loading: false, allHref: '/inventory', rows: [] } });
    expect(screen.getByText(/Todo tu inventario está en orden/)).toBeTruthy();
  });

  it('sin permiso no muestra las tarjetas de ventas, inventario ni actividad', () => {
    dashboard({ kpis: [], summary: null, stock: null, activity: null });
    expect(screen.queryByRole('heading', { name: 'Resumen del día' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Bajo inventario' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Actividad reciente' })).toBeNull();
    expect(screen.queryByLabelText('Indicadores del día')).toBeNull();
  });

  it('estados vacíos honestos cuando aún no hay servicios ni actividad', () => {
    dashboard({ summary: { loading: false, empty: true, rows: [] }, activity: { loading: false, rows: [] } });
    expect(screen.getByText('Aún no hay servicios registrados hoy.')).toBeTruthy();
    expect(screen.getByText(/aparecerán aquí/)).toBeTruthy();
  });

  it('el asistente abre el panel existente y el pie enlaza a lo legal y al soporte', async () => {
    const { props } = dashboard();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir asistente' }));
    expect(props.onOpenAssistant).toHaveBeenCalled();
    expect(screen.getByText('© 2026 Xiro Style. Todos los derechos reservados.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Soporte' }).getAttribute('href')).toBe('https://wa.me/573000000000');
    await userEvent.click(screen.getByRole('link', { name: 'Términos y condiciones' }));
    expect(props.navigate).toHaveBeenCalledWith('/terms');
  });

  it('conserva el acceso al perfil desde la cuenta y el cambio de logo, con su estado de carga', async () => {
    const idle = dashboard();
    expect(screen.getByText('Cuenta · @studio-ana')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Editar perfil' }));
    expect(idle.props.onEditProfile).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar logo' }));
    expect(idle.props.onChangeLogo).toHaveBeenCalledOnce();
    idle.unmount();
    dashboard({ logoBusy: true });
    const busy = screen.getByRole('button', { name: 'Cambiar logo' }) as HTMLButtonElement;
    expect(busy.querySelector('.xw-spinner')).toBeTruthy();
    expect(busy.disabled).toBe(true);
  });

  it('recuerda configurar el WhatsApp del negocio solo si falta, y lleva a Ajustes', async () => {
    const missing = dashboard({ needsWhatsappSetup: true });
    await userEvent.click(screen.getByRole('button', { name: /WhatsApp del negocio/ }));
    expect(missing.props.onGoBusinessSettings).toHaveBeenCalledOnce();
    missing.unmount();
    dashboard({ needsWhatsappSetup: false });
    expect(screen.queryByText('Datos del negocio')).toBeNull();
  });

  it('los accesos disponibles son enlaces reales y los que aún no existen no se pueden enfocar', async () => {
    const { props } = dashboard();
    const catalog = screen.getByRole('link', { name: /Catálogo/ });
    expect(catalog.getAttribute('href')).toBe('/catalog');
    await userEvent.click(catalog);
    expect(props.navigate).toHaveBeenCalledWith('/catalog');
    const soonTile = screen.getByText('Citas').closest('.xw-tile')!;
    expect(soonTile.getAttribute('aria-disabled')).toBe('true');
    expect(soonTile.getAttribute('href')).toBeNull();
    expect(soonTile.getAttribute('tabindex')).toBeNull();
  });

  it('con foto del negocio la usa de fondo del banner', () => {
    const { container } = dashboard({ heroUrl: 'https://cdn.test/foto.jpg' });
    expect((container.querySelector('.xw-hero') as HTMLElement).style.backgroundImage).toContain('foto.jpg');
  });

  it('sin violaciones de accesibilidad (axe)', async () => {
    const { container } = dashboard();
    await noViolations(container);
  });
});

/* ---------- Cabecera ---------- */

const rows: NotificationRow[] = [
  { id: 'low_stock:1:0', title: 'Productos con bajo inventario', detail: '1 por reponer o agotados', time: 'hace 5 min', priority: 'warning', unread: true, href: '/inventory?status=reorder' },
  { id: 'cash_closed', title: 'Caja sin abrir hoy', priority: 'info', unread: false, href: '/cash-opening' },
];

describe('NotificationsMenu', () => {
  const menu = (overrides: Partial<Parameters<typeof NotificationsMenu>[0]> = {}) => {
    const props = { t, rows, pending: 1, badge: '1', onOpenRow: vi.fn(), onReadAll: vi.fn(), onViewAll: vi.fn(), ...overrides };
    return { props, ...render(<NotificationsMenu {...props} />) };
  };

  it('la campana anuncia cuántas hay pendientes y no abre sola', () => {
    menu();
    expect(screen.getByRole('button', { name: '1 notificaciones pendientes' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Productos con bajo inventario')).toBeNull();
  });

  it('sin pendientes la insignia desaparece y el nombre lo dice', () => {
    menu({ pending: 0, badge: '' });
    expect(screen.getByRole('button', { name: 'Notificaciones, ninguna pendiente' })).toBeTruthy();
  });

  it('abre el panel, marca todas como leídas y navega al tocar una', async () => {
    const { props } = menu();
    await userEvent.click(screen.getByRole('button', { name: /notificaciones pendientes/ }));
    expect(screen.getByText('hace 5 min')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    expect(props.onReadAll).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('link', { name: /Productos con bajo inventario/ }));
    expect(props.onOpenRow).toHaveBeenCalledWith(rows[0]);
    expect(screen.queryByText('Caja sin abrir hoy')).toBeNull(); // el panel se cerró al navegar
  });

  it('Escape cierra y devuelve el foco al botón', async () => {
    menu();
    const bell = screen.getByRole('button', { name: /notificaciones pendientes/ });
    await userEvent.click(bell);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Caja sin abrir hoy')).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it('sin filas muestra un estado vacío en lugar de un panel en blanco', async () => {
    menu({ rows: [], pending: 0, badge: '' });
    await userEvent.click(screen.getByRole('button', { name: /Notificaciones/ }));
    expect(screen.getByText(/Estás al día/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Marcar todas como leídas' })).toBeNull();
  });
});

describe('MessagesMenu', () => {
  it('no inventa conversaciones: dice que aún no hay mensajes', async () => {
    render(<MessagesMenu t={t} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mensajes' }));
    expect(screen.getByText('Aún no tienes mensajes.')).toBeTruthy();
  });
});

describe('ProfileMenu', () => {
  const menu = (theme: 'dark' | 'light' = 'dark') => {
    const props = { t, name: 'Ana Pérez', roleLabel: 'Propietario', theme, onToggleTheme: vi.fn(), onProfile: vi.fn(), onLogout: vi.fn() };
    return { props, ...render(<ProfileMenu {...props} />) };
  };

  it('muestra nombre y rol, y ofrece perfil, tema y cerrar sesión', async () => {
    const { props } = menu();
    const trigger = screen.getByRole('button', { name: 'Menú de perfil: Ana Pérez' });
    expect(within(trigger).getByText('Propietario')).toBeTruthy();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: /Mi perfil/ }));
    expect(props.onProfile).toHaveBeenCalled();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('switch', { name: /Tema/ }));
    expect(props.onToggleTheme).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(props.onLogout).toHaveBeenCalled();
  });

  it('el interruptor de tema refleja el tema activo', async () => {
    menu('light');
    await userEvent.click(screen.getByRole('button', { name: /Menú de perfil/ }));
    expect(screen.getByRole('switch', { name: /Tema/ }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('HeaderSearch', () => {
  const search = (overrides: Partial<HeaderSearchProps> = {}) => {
    const props: HeaderSearchProps = {
      t,
      query: 'co',
      onQueryChange: vi.fn(),
      searchable: true,
      loading: false,
      clients: [{ id: 'c:1', title: 'Juan Pérez', subtitle: '3001112233', href: '/client/1', kind: 'client' }],
      items: [{ id: 'i:1', title: 'Corte clásico', subtitle: 'Servicios · $ 25.000', href: '/item/1', kind: 'item' }],
      onOpenRow: vi.fn(),
      ...overrides,
    };
    return { props, ...render(<HeaderSearch {...props} />) };
  };

  it('es un combobox con resultados agrupados y anuncia cuántos hay', async () => {
    search();
    const box = screen.getByRole('combobox', { name: 'Buscar en Xiro Style' });
    await userEvent.click(box);
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toContain('2 resultados');
  });

  it('flechas + Enter abren el resultado activo', async () => {
    const { props } = search();
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(props.onOpenRow).toHaveBeenCalledWith(props.items[0]);
  });

  it('con una sola letra pide escribir más y con nada encontrado lo dice', async () => {
    const first = search({ query: 'c', searchable: false, clients: [], items: [] });
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('status').textContent).toContain('Escribe al menos 2 letras');
    first.unmount();
    search({ query: 'zzz', clients: [], items: [] });
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('status').textContent).toContain('Sin resultados para "zzz".');
  });

  it('sin violaciones de accesibilidad (axe) con el panel abierto', async () => {
    const { container } = search();
    await userEvent.click(screen.getByRole('combobox'));
    await noViolations(container);
  });
});
