import type { AuditLogEntry, Employee } from '@xiro/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { EmployeesView, type EmployeesViewProps } from '../src/web/screens/Employees';
import { employeeQuota } from '@xiro/shared';
import { quotaView } from '../src/lib/employeesLogic';
import { tw } from '../src/web/shell/strings';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

const carlos: Employee = { id: 'e1', name: 'Carlos Ruiz', email: 'carlos@correo.com', phone: null, photoUrl: null, permissions: ['clients_view', 'clients_manage'], active: true, createdAt: '2026-01-01T00:00:00.000Z' };
const laura: Employee = { id: 'e2', name: 'Laura Gómez', email: null, phone: '573001112233', photoUrl: null, permissions: [], active: false, createdAt: '2026-01-02T00:00:00.000Z' };
const logs: AuditLogEntry[] = [
  { id: 'l1', userId: 'e1', userName: 'Carlos Ruiz', action: 'POST /clients', entityId: null, status: 201, createdAt: '2026-01-03T10:00:00.000Z' },
  { id: 'l2', userId: 'e1', userName: 'Carlos Ruiz', action: 'GET /cash/today', entityId: null, status: 403, createdAt: '2026-01-03T10:05:00.000Z' },
];

function view(overrides: Partial<EmployeesViewProps> = {}) {
  const props: EmployeesViewProps = {
    t,
    employees: [carlos, laura],
    logs,
    onCreate: vi.fn(async () => ({ ok: true as const })),
    onUpdate: vi.fn(async () => ({ ok: true as const })),
    onUploadPhoto: vi.fn(async () => ({ ok: true as const, photoUrl: '/media/employee.webp' })),
    onRemovePhoto: vi.fn(async () => ({ ok: true as const, photoUrl: null })),
    ...overrides,
  };
  return { props, ...render(<EmployeesView {...props} />) };
}

describe('EmployeesView — equipo', () => {
  it('los indicadores cuentan al equipo real (total, con acceso y desactivados)', () => {
    view();
    const kpis = within(screen.getByLabelText('Indicadores del día'));
    expect(kpis.getByText('Empleados').nextElementSibling!.textContent).toBe('2');
    expect(kpis.getByText('Con acceso').nextElementSibling!.textContent).toBe('1');
    expect(kpis.getByText('Desactivados').nextElementSibling!.textContent).toBe('1');
  });


  it('lista al equipo con estado y permisos, y pasa axe', async () => {
    const { container } = view();
    // El título de la página lo aporta el encabezado del contenedor; la vista trae indicadores y el panel con pestañas.
    expect(screen.getByRole('tablist', { name: 'Empleados' })).toBeTruthy();
    expect(screen.getByLabelText('Indicadores del día')).toBeTruthy();
    expect(screen.getByText('Carlos Ruiz')).toBeTruthy();
    expect(screen.getByText('carlos@correo.com')).toBeTruthy();
    expect(screen.getByText('573001112233')).toBeTruthy();
    expect(screen.getByText('Activo')).toBeTruthy();
    expect(screen.getByText('Desactivado')).toBeTruthy();
    expect(screen.getByText('Sin permisos')).toBeTruthy();
    expect(screen.getByText('Gestionar clientes')).toBeTruthy();
    await noViolations(container);
  });

  it('muestra un mensaje cuando aún no hay empleados', () => {
    view({ employees: [] });
    expect(screen.getByText(/Todavía no tienes empleados/)).toBeTruthy();
  });

  it('crear: valida contacto, contraseña y nombre antes de llamar al servidor', async () => {
    const { props } = view();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Nuevo empleado' }));
    await u.click(screen.getByRole('button', { name: 'Crear empleado' }));
    expect(screen.getByText('Ingresa un correo o un celular.')).toBeTruthy();
    expect(screen.getAllByText('Este campo es obligatorio.').length).toBeGreaterThan(0);
    expect(screen.getByText('Mínimo 8 caracteres, con una mayúscula y un número.', { selector: '.xw-error span, .xw-error' })).toBeTruthy();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('crear: envía los permisos normalizados (gestionar incluye ver; registrar servicios pide clientes y catálogo)', async () => {
    const { props } = view();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Nuevo empleado' }));
    const dialog = screen.getByRole('dialog');
    await u.type(within(dialog).getByLabelText(/^Nombre/), 'Marta Díaz');
    await u.type(within(dialog).getByLabelText('Correo electrónico'), 'marta@correo.com');
    await u.type(within(dialog).getByLabelText(/Contraseña inicial/), 'Secreta123');
    await u.click(within(dialog).getByRole('checkbox', { name: 'Registrar servicios realizados' }));
    // Lo implícito se marca solo...
    expect((within(dialog).getByRole('checkbox', { name: 'Ver clientes' }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole('checkbox', { name: 'Ver servicios e inventario' }) as HTMLInputElement).checked).toBe(true);
    // ...y no se puede quitar mientras otro permiso lo necesite.
    await u.click(within(dialog).getByRole('checkbox', { name: 'Ver clientes' }));
    expect((within(dialog).getByRole('checkbox', { name: 'Ver clientes' }) as HTMLInputElement).checked).toBe(true);

    await u.click(within(dialog).getByRole('button', { name: 'Crear empleado' }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith({ name: 'Marta Díaz', email: 'marta@correo.com', phone: undefined, password: 'Secreta123', permissions: ['clients_view', 'catalog_view', 'services_record'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('crear: si el servidor rechaza (p. ej. cuenta duplicada), muestra el error y deja abierto el formulario', async () => {
    view({ onCreate: vi.fn(async () => ({ ok: false as const, error: 'Ya existe una cuenta con ese correo o celular.' })) });
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Nuevo empleado' }));
    const dialog = screen.getByRole('dialog');
    await u.type(within(dialog).getByLabelText(/^Nombre/), 'Marta');
    await u.type(within(dialog).getByLabelText('Correo electrónico'), 'marta@correo.com');
    await u.type(within(dialog).getByLabelText(/Contraseña inicial/), 'Secreta123');
    await u.click(within(dialog).getByRole('button', { name: 'Crear empleado' }));
    expect(await within(dialog).findByText('Ya existe una cuenta con ese correo o celular.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('crear: el formulario de alta no ofrece foto todavía (no existe id al que subirla)', async () => {
    view();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nuevo empleado' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Agregar foto')).toBeNull();
  });

  it('editar: sin foto muestra la inicial; "Cambiar foto" sube el archivo elegido y "Eliminar" la quita (100% opcional)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { props } = view();
    const u = userEvent.setup();
    await u.click(screen.getAllByRole('button', { name: 'Editar' })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('C')).toBeTruthy(); // inicial de "Carlos Ruiz", sin foto todavía
    const file = new File(['img'], 'foto.jpg', { type: 'image/jpeg' });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, file);
    await waitFor(() => expect(props.onUploadPhoto).toHaveBeenCalledWith('e1', file));
    expect((await within(dialog).findByAltText('')).getAttribute('src')).toBe('http://localhost:3000/media/employee.webp');

    await u.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(props.onRemovePhoto).toHaveBeenCalledWith('e1'));
  });

  it('editar: cambia nombre y permisos; sin contraseña no la envía, y no pide correo/celular', async () => {
    const { props } = view();
    const u = userEvent.setup();
    await u.click(screen.getAllByRole('button', { name: 'Editar' })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Correo electrónico')).toBeNull();
    const name = within(dialog).getByLabelText(/^Nombre/);
    await u.clear(name);
    await u.type(name, 'Carlos R.');
    await u.click(within(dialog).getByRole('checkbox', { name: 'Ver servicios e inventario' }));
    await u.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith('e1', { name: 'Carlos R.', permissions: ['clients_view', 'clients_manage', 'catalog_view'] }));
  });

  it('editar: una contraseña nueva débil se rechaza; una válida se envía', async () => {
    const { props } = view();
    const u = userEvent.setup();
    await u.click(screen.getAllByRole('button', { name: 'Editar' })[0]!);
    const dialog = screen.getByRole('dialog');
    await u.type(within(dialog).getByLabelText(/Nueva contraseña/), 'debil');
    await u.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(within(dialog).getByText('Mínimo 8 caracteres, con una mayúscula y un número.')).toBeTruthy();
    expect(props.onUpdate).not.toHaveBeenCalled();
    await u.clear(within(dialog).getByLabelText(/Nueva contraseña/));
    await u.type(within(dialog).getByLabelText(/Nueva contraseña/), 'Nueva12345');
    await u.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ password: 'Nueva12345' })));
  });

  it('desactivar y reactivar llaman con active invertido', async () => {
    const { props } = view();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith('e1', { active: false }));
    await u.click(screen.getByRole('button', { name: 'Reactivar' }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith('e2', { active: true }));
  });

  it('un error al desactivar se muestra, no se traga', async () => {
    view({ onUpdate: vi.fn(async () => ({ ok: false as const, error: 'No encontrado.' })) });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('No encontrado.')).toBeTruthy();
  });
});

describe('EmployeesView — actividad', () => {
  it('traduce las acciones conocidas, marca los intentos sin permiso y pasa axe', async () => {
    const { container } = view();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Actividad' }));
    expect(screen.getByText(/creó un cliente/)).toBeTruthy();
    expect(screen.getByText(/GET \/cash\/today/)).toBeTruthy(); // lo desconocido se muestra tal cual, nunca se oculta
    expect(screen.getByText(/intento sin permiso/)).toBeTruthy();
    await noViolations(container);
  });

  it('mensaje vacío cuando no hay actividad', async () => {
    view({ logs: [] });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Actividad' }));
    expect(screen.getByText('Aún no hay actividad de tu equipo.')).toBeTruthy();
  });
});

describe('EmployeesView — cupos de empleados activos', () => {
  it('muestra "3 de 5" y permite agregar', () => {
    view({ quota: quotaView(t, employeeQuota(3)) });
    expect(screen.getByRole('status').textContent).toContain('3 de 5 empleados activos');
    expect(screen.getByRole('status').textContent).toContain('Te quedan 2 cupos.');
    expect((screen.getByRole('button', { name: /Nuevo empleado|Agregar/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('en el límite: no deja agregar ni reactivar, y lo explica', async () => {
    const { container } = view({ quota: quotaView(t, employeeQuota(5)) });
    expect(screen.getByRole('status').textContent).toContain('No quedan cupos');
    expect((screen.getByRole('button', { name: /Nuevo empleado|Agregar/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reactivar' }) as HTMLButtonElement).disabled).toBe(true);
    // Desactivar sigue disponible para liberar un cupo.
    expect((screen.getByRole('button', { name: 'Desactivar' }) as HTMLButtonElement).disabled).toBe(false);
    await noViolations(container);
  });

  it('negocio por encima del límite: se informa sin quitar a nadie', () => {
    view({ quota: quotaView(t, employeeQuota(7)) });
    expect(screen.getByRole('status').textContent).toContain('7 de 5 empleados activos');
    expect(screen.getByRole('status').textContent).toContain('Nadie pierde acceso');
  });
});
