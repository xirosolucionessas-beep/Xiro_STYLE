import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { ClientDetailView, type ClientDetailViewProps } from '../src/web/screens/ClientDetail';
import { NotificationsView } from '../src/web/screens/Notifications';
import { SubscriptionView } from '../src/web/screens/Subscription';
import { ItemDetailView, type ItemDetailViewProps } from '../src/web/screens/ItemDetail';
import { CatalogView, type CatalogViewProps } from '../src/web/screens/Catalog';
import { ClientsView, type ClientsViewProps } from '../src/web/screens/Clients';
import { InventoryView, type InventoryViewProps } from '../src/web/screens/Inventory';
import { ReportsView, type ReportsViewProps } from '../src/web/screens/Reports';
import { SettingsView, type NotificationsModel, type SettingsViewProps } from '../src/web/screens/Settings';
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
      { id: '1', name: 'Juan Pérez', phone: '3001112233', email: 'juan@x.co', photoUrl: null, since: '3 sept 2026', visits: '2', lastVisit: '20 sept 2026', href: '/client/1' },
      { id: '2', name: 'Marta Gómez', phone: null, email: null, photoUrl: null, since: '5 sept 2026', visits: '0', lastVisit: null, href: '/client/2' },
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

  it('sin foto muestra la inicial; con foto (opcional) muestra la imagen', () => {
    const { container } = clientsView({
      rows: [
        { id: '1', name: 'Juan Pérez', phone: null, email: null, photoUrl: null, since: '3 sept 2026', visits: null, lastVisit: null, href: '/client/1' },
        { id: '2', name: 'Marta Gómez', phone: null, email: null, photoUrl: '/media/marta.webp', since: '5 sept 2026', visits: null, lastVisit: null, href: '/client/2' },
      ],
    });
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0]!.querySelector('.xw-avatar')!.textContent).toBe('J');
    const img = rows[1]!.querySelector('.xw-avatar img')!;
    expect(img.getAttribute('src')).toBe('http://localhost:3000/media/marta.webp');
  });

  it('si la foto falla al cargar (archivo borrado, red…), vuelve de inmediato a la inicial en vez de quedarse con el ícono roto', () => {
    const { container } = clientsView({
      rows: [{ id: '2', name: 'Marta Gómez', phone: null, email: null, photoUrl: '/media/marta.webp', since: '5 sept 2026', visits: null, lastVisit: null, href: '/client/2' }],
    });
    const avatar = container.querySelector('.xw-avatar')!;
    expect(avatar.querySelector('img')).toBeTruthy();
    fireEvent.error(avatar.querySelector('img')!);
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.textContent).toBe('M');
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
      { id: '1', name: 'Cera', category: 'Productos', stock: 2, status: 'reorder', statusLabel: 'Por reponer', cost: '$ 9.000', photo: null, href: '/item/1', published: true },
      { id: '2', name: 'Aceite', category: 'Productos', stock: 0, status: 'out_of_stock', statusLabel: 'Agotado', cost: '—', photo: null, href: '/item/2', published: false },
    ],
    state: 'ready',
    onRetry: vi.fn(),
    navigate: vi.fn(),
    canPublish: true,
    selected: [],
    onToggleSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onQuickPublish: vi.fn(),
    onBulkPublish: vi.fn(),
    bulkBusy: false,
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

  it('muestra si cada artículo está publicado y el botón lo cambia', async () => {
    const { props } = inventoryView();
    expect(screen.getByText('Publicado')).toBeTruthy();
    expect(screen.getByText('Sin publicar')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Despublicar' })); // la fila publicada (Cera)
    expect(props.onQuickPublish).toHaveBeenCalledWith('1', false);
  });

  it('seleccionar filas muestra la barra de acciones en lote, y "Publicar seleccionados" llama a onBulkPublish', async () => {
    const { props } = inventoryView({ selected: ['1'] });
    await userEvent.click(screen.getByRole('button', { name: 'Publicar seleccionados' }));
    expect(props.onBulkPublish).toHaveBeenCalledWith(true);
    expect(screen.getByText('1 seleccionados')).toBeTruthy();
  });

  it('sin ninguna fila seleccionada no aparece la barra de acciones en lote', () => {
    inventoryView({ selected: [] });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('sin permiso de catálogo no se ofrece seleccionar ni publicar', () => {
    inventoryView({ canPublish: false });
    expect(screen.queryByText('Publicado')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

/* ---------- Reportes ---------- */

function reportsView(overrides: Partial<ReportsViewProps> = {}) {
  const props: ReportsViewProps = {
    t,
    period: 'week',
    onPeriod: vi.fn(),
    customFrom: '',
    customTo: '',
    onCustomFrom: vi.fn(),
    onCustomTo: vi.fn(),
    rangeLabel: '21 – 27 sept 2026',
    kpis: [{ id: 's', icon: 'coins', label: 'Ventas', value: '$ 65.000', trend: { direction: 'up', text: 'Sube frente al periodo anterior' } }],
    growth: { direction: 'up', percentLabel: '+18%', currentLabel: '$ 65.000', previousLabel: '$ 55.000' },
    loading: false,
    empty: false,
    bars: [
      { key: '2026-09-23', label: 'mié', aria: 'mié 23: $ 0', height: 0, empty: true, tooltip: { dateLabel: 'mié 23 sept', amountLabel: 'Ventas: $ 0', countLabel: 'Servicios: 0' } },
      { key: '2026-09-24', label: 'jue', aria: 'jue 24: $ 65.000', height: 1, value: '$ 65.000', empty: false, tooltip: { dateLabel: 'jue 24 sept', amountLabel: 'Ventas: $ 65.000', countLabel: 'Servicios: 3' } },
    ],
    topServices: [{ id: 'Corte', name: 'Corte', value: '$ 50.000', sub: '2 veces' }],
    topProducts: [{ id: 'Shampoo', name: 'Shampoo', value: '$ 15.000', sub: '1 vez' }],
    topClients: [{ id: 'Ana', name: 'Ana', value: '$ 65.000', sub: '3 servicios' }],
    paymentMethods: [{ id: 'cash', label: 'Efectivo', amountLabel: '$ 65.000', percent: 100 }],
    cashBalance: { openingLabel: '$ 25.000', cashSalesLabel: '$ 65.000', totalLabel: '$ 90.000' },
    employees: [{ id: 'e1', name: 'Carlos', countLabel: '3 veces', amountLabel: '$ 65.000', percent: 100 }],
    stock: { value: '$ 90.000', low: 2, href: '/inventory?status=reorder' },
    navigate: vi.fn(),
    onExportPdf: vi.fn(),
    onExportExcel: vi.fn(),
    exportingPdf: false,
    exportingExcel: false,
    ...overrides,
  };
  return { props, ...render(<ReportsView {...props} />) };
}

describe('ReportsView', () => {
  it('cada barra tiene su valor para lectores de pantalla y hay ranking de servicios, productos, clientes, formas de pago y empleados', async () => {
    const { container } = reportsView();
    const chart = screen.getByRole('list', { name: 'Ventas por día' });
    expect(within(chart).getByText('jue 24: $ 65.000')).toBeTruthy();
    expect(within(chart).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Corte')).toBeTruthy();
    expect(screen.getByText('Shampoo')).toBeTruthy();
    expect(screen.getByText('Efectivo')).toBeTruthy();
    expect(screen.getByText('Carlos')).toBeTruthy();
    expect(screen.getByText('Sube frente al periodo anterior')).toBeTruthy();
    expect(screen.getByText('+18%')).toBeTruthy();
    const cashBlock = container.querySelector('.xw-rep-cashbalance');
    expect(cashBlock?.textContent).toContain('$ 25.000'); // base inicial
    expect(cashBlock?.textContent).toContain('$ 90.000'); // total en caja = base + ventas en efectivo
    await noViolations(container);
  });

  it('sin ninguna base de caja registrada en el periodo, no muestra el bloque de "Total en caja" (nunca un $0 inventado)', () => {
    reportsView({ cashBalance: null });
    expect(screen.queryByText('Total en caja')).toBeNull();
  });

  it('cambia el periodo con un grupo de radios (hoy/semana/mes/año/personalizado)', async () => {
    const { props } = reportsView();
    const group = screen.getByRole('radiogroup', { name: 'Periodo' });
    expect(within(group).getByRole('radio', { name: 'Esta semana' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(within(group).getByRole('radio', { name: 'Este mes' }));
    expect(props.onPeriod).toHaveBeenCalledWith('month');
  });

  it('rango personalizado: muestra los campos de fecha y el error de validación si lo hay', () => {
    reportsView({ period: 'custom', customFrom: '2026-09-10', customTo: '2026-09-01', customError: 'Elige una fecha "desde" anterior o igual a la fecha "hasta".' });
    expect(screen.getByLabelText('Desde')).toBeTruthy();
    expect(screen.getByLabelText('Hasta')).toBeTruthy();
    expect(screen.getByText('Elige una fecha "desde" anterior o igual a la fecha "hasta".')).toBeTruthy();
  });

  it('sin ventas en el periodo no dibuja barras ni inventa rankings', () => {
    reportsView({ empty: true, bars: [], topServices: [], topProducts: [], topClients: [], paymentMethods: [], employees: [], cashBalance: null });
    expect(screen.queryByRole('list', { name: 'Ventas por día' })).toBeNull();
    expect(screen.getAllByText('Aún no hay servicios registrados en este periodo.').length).toBeGreaterThanOrEqual(2);
  });

  it('avisa si el historial puede estar cortado y enlaza al inventario bajo', async () => {
    const { props } = reportsView({ note: 'Se muestran tus últimos 200 registros' });
    expect(screen.getByRole('note').textContent).toContain('200 registros');
    await userEvent.click(screen.getByRole('link', { name: '2' }));
    expect(props.navigate).toHaveBeenCalledWith('/inventory?status=reorder');
  });

  it('los botones de exportar PDF/Excel llaman a sus handlers', async () => {
    const { props } = reportsView();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Reporte PDF' }));
    expect(props.onExportPdf).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }));
    expect(props.onExportExcel).toHaveBeenCalled();
  });
});

/* ---------- Ajustes ---------- */

const baseNotificationsModel = (): NotificationsModel => ({
  enabled: true,
  loyalty: true,
  billing: false,
  appointments: true,
  reviews: true,
  clients: true,
  sales: true,
  inventory: true,
  employees: true,
  security: true,
  busy: false,
  onToggle: vi.fn(),
  onLoyalty: vi.fn(),
  onBilling: vi.fn(),
  onAppointments: vi.fn(),
  onReviews: vi.fn(),
  onClients: vi.fn(),
  onSales: vi.fn(),
  onInventory: vi.fn(),
  onEmployees: vi.fn(),
  onSecurity: vi.fn(),
  onTest: vi.fn(),
});

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
    notifications: baseNotificationsModel(),
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
    settingsView({ notifications: { ...baseNotificationsModel(), enabled: false, billing: true, busy: true } });
    expect(screen.queryByRole('switch', { name: 'Fidelización' })).toBeNull();
    expect((screen.getByRole('switch', { name: 'Activar notificaciones' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('el empleado no ve el panel de notificaciones del negocio', () => {
    settingsView({ notifications: null });
    expect(screen.queryByRole('heading', { name: 'Notificaciones' })).toBeNull();
  });

  it('muestra el aviso del navegador cuando no se pueden activar', () => {
    settingsView({ notifications: { ...baseNotificationsModel(), enabled: false, billing: true, note: 'Bloqueadas en este navegador' } });
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

/* ---------- Fichas ---------- */

function clientDetail(overrides: Partial<ClientDetailViewProps> = {}) {
  const props: ClientDetailViewProps = {
    t,
    rows: [
      { id: 'phone', label: 'Celular', value: '+573001112233', href: 'tel:+573001112233' },
      { id: 'email', label: 'Correo electrónico', value: '—' },
    ],
    history: { loading: false, rows: [{ id: 'r1', label: 'Corte', note: 'Con degradado', amount: '$ 25.000', date: '20 sept 2026' }] },
    kpis: [{ id: 'count', icon: 'scissors', label: 'Servicios', value: '1' }],
    whatsappHref: 'https://wa.me/573001112233',
    callHref: 'tel:+573001112233',
    deleting: false,
    canManage: true,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    anonymizing: false,
    onAnonymize: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ClientDetailView {...props} />) };
}

describe('ClientDetailView', () => {
  it('muestra el contacto, el historial real y las acciones (WhatsApp, llamar, editar, eliminar datos, eliminar)', async () => {
    const { props, container } = clientDetail();
    expect(screen.getByRole('link', { name: '+573001112233' }).getAttribute('href')).toBe('tel:+573001112233');
    expect(screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: /Llamar/ }).getAttribute('href')).toBe('tel:+573001112233');
    expect(screen.getByText('Con degradado')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar datos personales' }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(props.onAnonymize).toHaveBeenCalledOnce();
    expect(props.onDelete).toHaveBeenCalledOnce();
    await noViolations(container);
  });

  it('sin permiso no muestra el historial ni editar/eliminar; sin teléfono no ofrece WhatsApp ni llamar', () => {
    clientDetail({ history: null, kpis: [], canManage: false, whatsappHref: undefined, callHref: undefined });
    expect(screen.queryByRole('heading', { name: 'Historial de servicios' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
  });

  it('un cliente sin servicios muestra el estado vacío del historial', () => {
    clientDetail({ history: { loading: false, rows: [] } });
    expect(screen.getByText('Este cliente aún no tiene servicios registrados.')).toBeTruthy();
  });
});

function itemDetail(overrides: Partial<ItemDetailViewProps> = {}) {
  const props: ItemDetailViewProps = {
    t,
    name: 'Cera',
    photos: [],
    status: 'reorder',
    statusLabel: 'Por reponer',
    description: 'Cera fijadora',
    kpis: [{ id: 'stock', icon: 'package', label: 'Stock', value: '2 unidades' }, { id: 'margin', icon: 'trending-up', label: 'Margen', value: '—' }],
    rows: [{ id: 'code', label: 'Código o referencia', value: 'CE-1' }],
    notes: 'Pedir a proveedor',
    deleting: false,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ItemDetailView {...props} />) };
}

describe('ItemDetailView', () => {
  it('muestra estado en texto, datos internos y notas, con editar y eliminar', async () => {
    const { props, container } = itemDetail();
    expect(screen.getByText('Por reponer')).toBeTruthy();
    expect(screen.getByText('CE-1')).toBeTruthy();
    expect(screen.getByText('Pedir a proveedor')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Editar artículo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(props.onDelete).toHaveBeenCalledOnce();
    await noViolations(container);
  });

  it('sin notas no muestra esa fila y mientras elimina el botón queda ocupado', () => {
    itemDetail({ notes: '', deleting: true });
    expect(screen.queryByText('Notas internas')).toBeNull();
    expect(screen.getByRole('button', { name: /Eliminar/ }).getAttribute('aria-busy')).toBe('true');
  });
});

/* ---------- Notificaciones ---------- */

describe('NotificationsView', () => {
  const unread = [{ id: 'low', title: 'Productos con bajo inventario', detail: '2 por reponer', time: 'hace 5 min', priority: 'warning' as const }];
  const done = [{ id: 'cash', title: 'Caja sin abrir hoy', time: 'hace 1 h', priority: 'info' as const }];
  const view = (overrides: Partial<Parameters<typeof NotificationsView>[0]> = {}) => {
    const props = { t, loading: false, unread, done, permissionOff: false, onOpen: vi.fn(), onDismiss: vi.fn(), onReadAll: vi.fn(), onSettings: vi.fn(), ...overrides };
    return { props, ...render(<NotificationsView {...props} />) };
  };

  it('separa pendientes y leídas, abre, descarta y marca todas como leídas', async () => {
    const { props, container } = view();
    await userEvent.click(screen.getByRole('button', { name: /^Productos con bajo inventario/ }));
    expect(props.onOpen).toHaveBeenCalledWith('low');
    await userEvent.click(screen.getByRole('button', { name: 'Descartar: Caja sin abrir hoy' }));
    expect(props.onDismiss).toHaveBeenCalledWith('cash');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    expect(props.onReadAll).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Leídas' })).toBeTruthy();
    await noViolations(container);
  });

  it('sin alertas muestra el estado vacío y sin pendientes no ofrece marcar todas', () => {
    view({ unread: [], done: [] });
    expect(screen.getByText('No tienes notificaciones pendientes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Marcar todas como leídas' })).toBeNull();
  });

  it('avisa si el navegador las bloqueó, y solo el dueño ve el acceso a ajustes', () => {
    view({ permissionOff: true, onSettings: undefined });
    expect(screen.getByRole('status').textContent).toContain('desactivadas');
    expect(screen.queryByRole('button', { name: 'Ajustes de notificaciones' })).toBeNull();
  });
});

/* ---------- Plan y pago ---------- */

describe('SubscriptionView', () => {
  const subscribe = (overrides: Partial<Parameters<typeof SubscriptionView>[0]> = {}) => {
    const props = {
      t,
      language: 'es',
      currency: 'COP' as const,
      subscription: { plan: null, status: 'none' as const, platform: null, paymentMethod: null, trialEndsAt: null, currentPeriodEnd: null, nextBillingAt: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: null, hasAccess: false },
      onCheckout: vi.fn(async () => ({ instructions: 'Transfiere a la cuenta 123' })),
      onSkipTrial: vi.fn(async () => ({ ok: true as const })),
      ...overrides,
    };
    return { props, ...render(<SubscriptionView {...props} />) };
  };

  it('muestra beneficios, dos pasos y un resumen del plan elegido (anual por defecto)', async () => {
    const { container } = subscribe();
    expect(screen.getByRole('heading', { level: 1, name: 'Elige tu plan' })).toBeTruthy();
    expect(screen.getByText('Programa de fidelización con premios')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Elige tu plan' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Método de pago' })).toBeTruthy();
    const summary = screen.getByRole('region', { name: 'Resumen' });
    expect(summary.textContent).toContain('Anual');
    await userEvent.click(screen.getByRole('radio', { name: /Mensual/ }));
    expect(summary.textContent).toContain('Mensual');
    await noViolations(container);
  });

  it('con transferencia muestra las instrucciones y con "saltar" activa la prueba sin pasar por un pago', async () => {
    const { props } = subscribe();
    await userEvent.click(screen.getByRole('radio', { name: /Transferencia/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver datos para transferir' }));
    expect((await screen.findByRole('status')).textContent).toContain('Transfiere a la cuenta 123');
    await userEvent.click(screen.getByRole('button', { name: /Saltar por ahora/ }));
    expect(props.onSkipTrial).toHaveBeenCalledWith('yearly');
  });

  it('quien ya tiene un plan no ve la prueba gratis pero sí puede cerrar', async () => {
    const onClose = vi.fn();
    subscribe({ subscription: { plan: 'monthly', status: 'active', platform: 'web', paymentMethod: 'card', trialEndsAt: null, currentPeriodEnd: null, nextBillingAt: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: null, hasAccess: true }, onClose });
    expect(screen.getByText(/Tu plan actual/)).toBeTruthy();
    expect(screen.queryByText(/días gratis/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('en prueba gratis se anuncia como prueba, NUNCA como "tu plan actual" (no se ha cobrado nada todavía)', () => {
    subscribe({ subscription: { plan: 'yearly', status: 'trial', platform: 'web', paymentMethod: null, trialEndsAt: '2026-10-01T00:00:00Z', currentPeriodEnd: null, nextBillingAt: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: null, hasAccess: true } });
    expect(screen.queryByText(/Tu plan actual/)).toBeNull();
    expect(screen.getByText(/Prueba gratis del plan Anual/)).toBeTruthy();
  });
});
