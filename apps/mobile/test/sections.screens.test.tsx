import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { AgendaView } from '../src/web/screens/Agenda';
import { CatalogView, type CatalogViewProps } from '../src/web/screens/Catalog';
import { ClientsView, type ClientsViewProps } from '../src/web/screens/Clients';
import { InventoryView, type InventoryViewProps } from '../src/web/screens/Inventory';
import { ReportsView, type ReportsViewProps } from '../src/web/screens/Reports';
import { SettingsView, type SettingsViewProps } from '../src/web/screens/Settings';
import { tw } from '../src/web/shell/strings';
import { FilterChips, type KpiView } from '../src/web/ui/Page';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

const kpis: KpiView[] = [
  { id: 'a', icon: 'users', label: 'Clientes', value: '2' },
  { id: 'b', icon: 'plus', label: 'Nuevos este mes', value: '1' },
];

/* ---------- Clientes ---------- */

function clientsView(overrides: Partial<ClientsViewProps> = {}) {
  const props: ClientsViewProps = {
    t,
    kpis,
    search: '',
    onSearch: vi.fn(),
    appliedQuery: '',
    rows: [
      { id: '1', name: 'Juan Pérez', phone: '3001112233', email: 'juan@x.co', since: '3 sept 2026', visits: '2', lastVisit: '20 sept 2026', href: '/client/1' },
      { id: '2', name: 'Marta Gómez', phone: null, email: null, since: '5 sept 2026', visits: '0', lastVisit: null, href: '/client/2' },
    ],
    showServiceCols: true,
    state: 'ready',
    onRetry: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ClientsView {...props} />) };
}

describe('ClientsView', () => {
  it('es una tabla con encabezados, un enlace real por fila y "—" donde no hay dato', async () => {
    const { props, container } = clientsView();
    const table = screen.getByRole('table', { name: 'Lista de clientes' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toContain('Último servicio');
    const link = within(table).getByRole('link', { name: 'Juan Pérez' });
    expect(link.getAttribute('href')).toBe('/client/1');
    await userEvent.click(link);
    expect(props.navigate).toHaveBeenCalledWith('/client/1');
    const marta = within(table).getByRole('link', { name: 'Marta Gómez' }).closest('tr')!;
    expect(marta.textContent).toContain('—');
    await noViolations(container);
  });

  it('sin permiso para ver servicios no muestra esas columnas', () => {
    clientsView({ showServiceCols: false });
    expect(screen.queryByRole('columnheader', { name: 'Servicios' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Último servicio' })).toBeNull();
  });

  it('el buscador avisa cada cambio y anuncia cuántos resultados hay', async () => {
    const { props } = clientsView();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por nombre, teléfono o correo' }), 'ju');
    expect(props.onSearch).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Mostrando 2 resultados');
  });

  it('estados: cargando, error con reintento, vacío y sin resultados de búsqueda', async () => {
    const loading = clientsView({ state: 'loading', rows: [] });
    expect(screen.getByRole('status').textContent).toContain('Cargando');
    loading.unmount();
    const error = clientsView({ state: 'error', errorMessage: 'Sin conexión', rows: [] });
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Reintentar' }));
    expect(error.props.onRetry).toHaveBeenCalled();
    error.unmount();
    clientsView({ rows: [], emptyAction: <button>Nuevo cliente</button> });
    expect(screen.getByText('Aún no tienes clientes.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nuevo cliente' })).toBeTruthy();
  });

  it('una búsqueda sin coincidencias lo dice con la consulta', () => {
    clientsView({ rows: [], appliedQuery: 'zzz' });
    expect(screen.getByText('Sin resultados para "zzz".')).toBeTruthy();
  });
});

/* ---------- Servicios ---------- */

function catalogView(overrides: Partial<CatalogViewProps> = {}) {
  const props: CatalogViewProps = {
    t,
    kpis,
    categories: [{ id: 'c1', label: 'Servicios' }, { id: 'c2', label: 'Productos' }],
    category: null,
    onCategory: vi.fn(),
    cards: [
      { id: '1', name: 'Corte clásico', description: 'Corte a tijera', price: '$ 25.000', photo: null, published: true, href: '/catalog-item/1' },
      { id: '2', name: 'Tinte', description: '', price: '$ 60.000', photo: 'https://cdn.test/tinte.jpg', published: false, href: '/catalog-item/2' },
    ],
    state: 'ready',
    onRetry: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CatalogView {...props} />) };
}

describe('CatalogView', () => {
  it('muestra tarjetas con precio, foto opcional y avisa lo que no está publicado', async () => {
    const { props, container } = catalogView();
    const list = screen.getByRole('list', { name: 'Servicios del catálogo' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('$ 25.000')).toBeTruthy();
    expect(within(list).getByText('Oculto del catálogo')).toBeTruthy();
    await userEvent.click(within(list).getByRole('link', { name: 'Corte clásico' }));
    expect(props.navigate).toHaveBeenCalledWith('/catalog-item/1');
    await noViolations(container);
  });

  it('el filtro por categoría es un grupo de botones con estado y vuelve a "todas" al repetir', async () => {
    const { props } = catalogView({ category: 'c1' });
    const group = screen.getByRole('group', { name: 'Filtrar por categoría' });
    expect(within(group).getByRole('button', { name: 'Servicios' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'Productos' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(within(group).getByRole('button', { name: 'Servicios' }));
    expect(props.onCategory).toHaveBeenCalledWith(null);
    await userEvent.click(within(group).getByRole('button', { name: 'Productos' }));
    expect(props.onCategory).toHaveBeenCalledWith('c2');
  });

  it('sin artículos invita a agregar el primero', () => {
    catalogView({ cards: [], emptyAction: <button>Agregar al catálogo</button> });
    expect(screen.getByText('No se encontraron artículos.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agregar al catálogo' })).toBeTruthy();
  });
});

/* ---------- Inventario ---------- */

function inventoryView(overrides: Partial<InventoryViewProps> = {}) {
  const props: InventoryViewProps = {
    t,
    kpis,
    categories: [{ id: 'c1', label: 'Productos' }],
    category: null,
    onCategory: vi.fn(),
    statuses: [{ id: 'available', label: 'Disponible' }, { id: 'reorder', label: 'Por reponer' }, { id: 'out_of_stock', label: 'Agotado' }],
    status: null,
    onStatus: vi.fn(),
    rows: [
      { id: '1', name: 'Cera', category: 'Productos', stock: 2, status: 'reorder', statusLabel: 'Por reponer', cost: '$ 9.000', photo: null, href: '/item/1' },
      { id: '2', name: 'Aceite', category: 'Productos', stock: 0, status: 'out_of_stock', statusLabel: 'Agotado', cost: '—', photo: null, href: '/item/2' },
    ],
    state: 'ready',
    onRetry: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<InventoryView {...props} />) };
}

describe('InventoryView', () => {
  it('tabla con stock, estado en texto (no solo color) y costo o "—"', async () => {
    const { props, container } = inventoryView();
    const table = screen.getByRole('table', { name: 'Artículos del inventario' });
    const cera = within(table).getByRole('link', { name: 'Cera' }).closest('tr')!;
    expect(cera.textContent).toContain('Por reponer');
    expect(cera.textContent).toContain('$ 9.000');
    expect(within(table).getByRole('link', { name: 'Aceite' }).closest('tr')!.textContent).toContain('—');
    await userEvent.click(within(table).getByRole('link', { name: 'Cera' }));
    expect(props.navigate).toHaveBeenCalledWith('/item/1');
    await noViolations(container);
  });

  it('filtra por estado con botones que reflejan la selección', async () => {
    const { props } = inventoryView({ status: 'reorder' });
    const group = screen.getByRole('group', { name: 'Filtrar por estado' });
    expect(within(group).getByRole('button', { name: 'Por reponer' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(group).getByRole('button', { name: 'Agotado' }));
    expect(props.onStatus).toHaveBeenCalledWith('out_of_stock');
  });

  it('sin resultados en el filtro muestra el estado vacío', () => {
    inventoryView({ rows: [] });
    expect(screen.getByText('No se encontraron artículos.')).toBeTruthy();
  });
});

/* ---------- Reportes ---------- */

function reportsView(overrides: Partial<ReportsViewProps> = {}) {
  const props: ReportsViewProps = {
    t,
    period: '7',
    onPeriod: vi.fn(),
    kpis: [{ id: 's', icon: 'coins', label: 'Ventas', value: '$ 65.000', trend: { direction: 'up', text: 'Sube frente al periodo anterior' } }],
    loading: false,
    empty: false,
    bars: [
      { key: '2026-09-23', label: 'mié', aria: 'mié 23: $ 0', height: 0, empty: true },
      { key: '2026-09-24', label: 'jue', aria: 'jue 24: $ 65.000', height: 1, value: '$ 65.000', empty: false },
    ],
    topServices: [{ id: 'Corte', name: 'Corte', value: '$ 50.000', sub: '2 veces' }],
    topClients: [{ id: 'Ana', name: 'Ana', value: '$ 65.000', sub: '3 servicios' }],
    stock: { value: '$ 90.000', low: 2, href: '/inventory?status=reorder' },
    navigate: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ReportsView {...props} />) };
}

describe('ReportsView', () => {
  it('cada barra tiene su valor para lectores de pantalla y hay ranking de servicios y clientes', async () => {
    const { container } = reportsView();
    const chart = screen.getByRole('list', { name: 'Ventas por día' });
    expect(within(chart).getByText('jue 24: $ 65.000')).toBeTruthy();
    expect(within(chart).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Corte')).toBeTruthy();
    expect(screen.getByText('Sube frente al periodo anterior')).toBeTruthy();
    await noViolations(container);
  });

  it('cambia el periodo con botones de estado', async () => {
    const { props } = reportsView();
    const group = screen.getByRole('group', { name: 'Periodo' });
    expect(within(group).getByRole('button', { name: 'Últimos 7 días' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(group).getByRole('button', { name: 'Últimos 30 días' }));
    expect(props.onPeriod).toHaveBeenCalledWith('30');
  });

  it('sin servicios en el periodo no dibuja barras ni inventa rankings', () => {
    reportsView({ empty: true, bars: [], topServices: [], topClients: [] });
    expect(screen.queryByRole('list', { name: 'Ventas por día' })).toBeNull();
    expect(screen.getAllByText('Aún no hay servicios registrados en este periodo.').length).toBeGreaterThanOrEqual(2);
  });

  it('avisa si el historial puede estar cortado y enlaza al inventario bajo', async () => {
    const { props } = reportsView({ note: 'Se muestran tus últimos 200 registros' });
    expect(screen.getByRole('note').textContent).toContain('200 registros');
    await userEvent.click(screen.getByRole('link', { name: '2' }));
    expect(props.navigate).toHaveBeenCalledWith('/inventory?status=reorder');
  });
});

/* ---------- Citas ---------- */

describe('AgendaView', () => {
  it('dice "Próximamente" y no muestra citas de ejemplo; ofrece lo que sí existe', async () => {
    const navigate = vi.fn();
    const { container } = render(<AgendaView t={t} navigate={navigate} />);
    expect(screen.getByText('Próximamente')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'La agenda de citas está en camino' })).toBeTruthy();
    await userEvent.click(screen.getByRole('link', { name: 'Ver Reportes' }));
    expect(navigate).toHaveBeenCalledWith('/reports');
    await noViolations(container);
  });
});

/* ---------- Ajustes ---------- */

function settingsView(overrides: Partial<SettingsViewProps> = {}) {
  const props: SettingsViewProps = {
    t,
    accountLinks: [
      { id: 'profile', icon: 'user', title: 'Ana Pérez', sub: 'Cuenta · Studio Ana', href: '/profile' },
      { id: 'team', icon: 'briefcase', title: 'Equipo', sub: '2 empleados', href: '/employees' },
    ],
    language: 'es',
    onLanguage: vi.fn(),
    darkMode: true,
    onDarkMode: vi.fn(),
    notifications: { enabled: true, loyalty: true, billing: false, busy: false, onToggle: vi.fn(), onLoyalty: vi.fn(), onBilling: vi.fn(), onTest: vi.fn() },
    supportLinks: [{ id: 'logout', icon: 'log-out', title: 'Cerrar sesión', sub: 'Salir', tone: 'danger', onPress: vi.fn() }],
    navigate: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<SettingsView {...props} />) };
}

describe('SettingsView', () => {
  it('enlaces reales a cada ajuste y acciones como botones', async () => {
    const { props, container } = settingsView();
    const link = screen.getByRole('link', { name: /Equipo/ });
    expect(link.getAttribute('href')).toBe('/employees');
    await userEvent.click(link);
    expect(props.navigate).toHaveBeenCalledWith('/employees');
    await userEvent.click(screen.getByRole('button', { name: /Cerrar sesión/ }));
    expect(props.supportLinks[0]!.onPress).toHaveBeenCalled();
    await noViolations(container);
  });

  it('idioma y tema: el estado se anuncia y el cambio llega a la pantalla', async () => {
    const { props } = settingsView();
    const language = screen.getByRole('group', { name: 'Idioma' });
    expect(within(language).getByRole('button', { name: 'Español' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(language).getByRole('button', { name: 'English' }));
    expect(props.onLanguage).toHaveBeenCalledWith('en');
    const dark = screen.getByRole('switch', { name: 'Modo oscuro' });
    expect(dark.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(dark);
    expect(props.onDarkMode).toHaveBeenCalledWith(false);
  });

  it('las categorías de notificación solo aparecen con las notificaciones activas y respetan "ocupado"', async () => {
    const on = settingsView();
    expect(screen.getByRole('switch', { name: 'Fidelización' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Facturación y pagos' }).getAttribute('aria-checked')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar notificación de prueba' }));
    expect(on.props.notifications!.onTest).toHaveBeenCalled();
    on.unmount();
    settingsView({ notifications: { enabled: false, loyalty: true, billing: true, busy: true, onToggle: vi.fn(), onLoyalty: vi.fn(), onBilling: vi.fn(), onTest: vi.fn() } });
    expect(screen.queryByRole('switch', { name: 'Fidelización' })).toBeNull();
    expect((screen.getByRole('switch', { name: 'Activar notificaciones' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('el empleado no ve el panel de notificaciones del negocio', () => {
    settingsView({ notifications: null });
    expect(screen.queryByRole('heading', { name: 'Notificaciones' })).toBeNull();
  });

  it('muestra el aviso del navegador cuando no se pueden activar', () => {
    settingsView({ notifications: { enabled: false, loyalty: true, billing: true, busy: false, note: 'Bloqueadas en este navegador', onToggle: vi.fn(), onLoyalty: vi.fn(), onBilling: vi.fn(), onTest: vi.fn() } });
    expect(screen.getByText('Bloqueadas en este navegador')).toBeTruthy();
  });
});

/* ---------- FilterChips ---------- */

describe('FilterChips', () => {
  it('es un grupo con nombre y se opera con teclado nativo (Espacio/Enter)', async () => {
    const onChange = vi.fn();
    render(<FilterChips label="Estado" options={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} value="a" onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard('{Tab}{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
