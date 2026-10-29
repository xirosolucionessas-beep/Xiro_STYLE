import type { User } from '@xiro/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileView, type ProfileViewProps } from '../src/web/screens/Profile';
import { tw } from '../src/web/shell/strings';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

// jsdom no implementa matchMedia: se simula escritorio ancho para que PhoneField use el combobox (no la hoja móvil).
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

const user: User = { id: '1', name: 'Ana Pérez', email: 'ana@correo.com', phone: '573001234567', photoUrl: null, language: 'es', theme: 'dark', businessId: 'b1', role: 'owner', permissions: [] };

function profile(overrides: Partial<ProfileViewProps> = {}) {
  const props: ProfileViewProps = {
    t,
    user,
    businessName: 'Studio Ana',
    isOwner: true,
    onSaveName: vi.fn(async () => ({ ok: true as const })),
    onChangePhoto: vi.fn(async () => ({ ok: true as const })),
    onRemovePhoto: vi.fn(async () => ({ ok: true as const })),
    onRequestPhoneChange: vi.fn(async () => ({ ok: true as const })),
    onConfirmPhoneChange: vi.fn(async () => ({ ok: true as const })),
    onChangePassword: vi.fn(async () => ({ ok: true as const })),
    onDeleteBusiness: vi.fn(async () => ({ ok: true as const })),
    onLogout: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ProfileView {...props} />) };
}

describe('ProfileView', () => {
  it('shows the account fields and passes axe', async () => {
    const { container } = profile();
    // El título de la página lo aporta el encabezado del contenedor; la vista arranca en el campo del nombre.
    expect(screen.getByLabelText('Nombre completo')).toBeTruthy();
    expect((screen.getByLabelText('Nombre completo') as HTMLInputElement).value).toBe('Ana Pérez');
    expect(screen.getByText('ana@correo.com')).toBeTruthy();
    expect(screen.getByText('+573001234567')).toBeTruthy();
    expect(screen.getByText('Studio Ana')).toBeTruthy();
    await noViolations(container);
  });

  it('shows a placeholder when there is no phone on file, and the name can still be edited and saved', async () => {
    const { props } = profile({ user: { ...user, phone: null } });
    expect(screen.getByText('Sin celular registrado')).toBeTruthy();
    const nameInput = screen.getByLabelText('Nombre completo');
    const user2 = userEvent.setup();
    await user2.clear(nameInput);
    await user2.type(nameInput, 'Ana Gómez');
    await user2.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(props.onSaveName).toHaveBeenCalledWith('Ana Gómez'));
    expect(await screen.findByText('Guardado')).toBeTruthy();
  });

  it('walks the phone-change flow: pick a country, request a code, confirm it', async () => {
    const onRequestPhoneChange = vi.fn(async () => ({ ok: true as const }));
    const onConfirmPhoneChange = vi.fn(async () => ({ ok: true as const }));
    const { props } = profile({ onRequestPhoneChange, onConfirmPhoneChange });
    const u = userEvent.setup();

    await u.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Cambiar celular' })).toBeTruthy();
    const dialBox = screen.getByRole('combobox', { name: /Celular nuevo/ });
    expect(dialBox.textContent).toContain('+57');
    await u.click(dialBox);
    await u.click(within(screen.getByRole('listbox', { name: 'Celular nuevo' })).getByRole('option', { name: /México/ }));
    expect(dialBox.textContent).toContain('+52');
    await u.type(screen.getByLabelText('Celular nuevo'), '5512345678');

    const sendBtn = screen.getByRole('button', { name: 'Enviar código' });
    expect(sendBtn.hasAttribute('disabled')).toBe(false);
    await u.click(sendBtn);
    await waitFor(() => expect(onRequestPhoneChange).toHaveBeenCalledWith('525512345678'));

    expect(await screen.findByText('Te enviamos un código de verificación por SMS al número nuevo.')).toBeTruthy();
    await u.keyboard('123456');
    await u.click(screen.getByRole('button', { name: 'Confirmar celular' }));
    await waitFor(() => expect(onConfirmPhoneChange).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('Celular actualizado.')).toBeTruthy();
    expect(props.onSaveName).not.toHaveBeenCalled(); // no toca el nombre
  });

  it('shows the API error when the code is wrong, and "Cancelar" discards the whole flow', async () => {
    const onConfirmPhoneChange = vi.fn(async () => ({ ok: false as const, error: 'El código es incorrecto o expiró.' }));
    profile({ onRequestPhoneChange: vi.fn(async () => ({ ok: true as const })), onConfirmPhoneChange });
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Cambiar' }));
    await u.type(screen.getByLabelText('Celular nuevo'), '3001234567');
    await u.click(screen.getByRole('button', { name: 'Enviar código' }));
    await screen.findByLabelText('Dígito 1 / 6');
    await u.keyboard('000000');
    await u.click(screen.getByRole('button', { name: 'Confirmar celular' }));
    expect(await screen.findByText('El código es incorrecto o expiró.')).toBeTruthy();

    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { level: 2, name: 'Cambiar celular' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeTruthy();
  });

  it('changes the password: validates the two new ones match, then calls onChangePassword and shows success', async () => {
    const onChangePassword = vi.fn(async () => ({ ok: true as const }));
    profile({ onChangePassword });
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Contraseña actual'), 'Actual123');
    await u.type(screen.getByLabelText('Contraseña nueva'), 'Nueva456');
    await u.type(screen.getByLabelText('Confirmar contraseña nueva'), 'Nueva789'); // no coincide
    await u.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('Las dos contraseñas nuevas no coinciden.')).toBeTruthy();
    expect(onChangePassword).not.toHaveBeenCalled();

    await u.clear(screen.getByLabelText('Confirmar contraseña nueva'));
    await u.type(screen.getByLabelText('Confirmar contraseña nueva'), 'Nueva456');
    await u.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    await waitFor(() => expect(onChangePassword).toHaveBeenCalledWith('Actual123', 'Nueva456'));
    expect(await screen.findByText('Tu contraseña se actualizó.')).toBeTruthy();
  });

  it('shows the server error (e.g. wrong current password) without touching the business-deletion zone', async () => {
    const onChangePassword = vi.fn(async () => ({ ok: false as const, error: 'La contraseña actual no es correcta.' }));
    profile({ onChangePassword });
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Contraseña actual'), 'Incorrecta');
    await u.type(screen.getByLabelText('Contraseña nueva'), 'Nueva456');
    await u.type(screen.getByLabelText('Confirmar contraseña nueva'), 'Nueva456');
    await u.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeTruthy();
  });

  it('only an owner sees the danger zone; an employee never sees the delete-business button', async () => {
    profile({ isOwner: false });
    expect(screen.queryByText('Zona de peligro')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Eliminar negocio definitivamente' })).toBeNull();
  });

  it('danger zone: the confirm button stays disabled during the countdown, "Cancelar" always works, and a real submit calls onDeleteBusiness', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDeleteBusiness = vi.fn(async () => ({ ok: true as const }));
    profile({ onDeleteBusiness });
    const u = userEvent.setup({ delay: null });
    await u.click(screen.getByRole('button', { name: 'Opciones avanzadas del negocio' }));
    await u.click(screen.getByRole('button', { name: 'Eliminar negocio definitivamente' }));
    expect(screen.getByRole('heading', { name: '¿Eliminar tu negocio para siempre?' })).toBeTruthy();
    await u.type(screen.getByLabelText('Confirma con tu contraseña actual'), 'Secreta123');

    const waitingBtn = screen.getByRole('button', { name: /Espera \d s…/ });
    expect(waitingBtn.hasAttribute('disabled')).toBe(true);
    expect(onDeleteBusiness).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    const confirmBtn = await screen.findByRole('button', { name: 'Sí, eliminar definitivamente' });
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);
    await u.click(confirmBtn);
    await waitFor(() => expect(onDeleteBusiness).toHaveBeenCalledWith('Secreta123'));
    vi.useRealTimers();
  });

  it('danger zone: "Cancelar" closes the modal without ever calling onDeleteBusiness', async () => {
    const onDeleteBusiness = vi.fn(async () => ({ ok: true as const }));
    profile({ onDeleteBusiness });
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Opciones avanzadas del negocio' }));
    await u.click(screen.getByRole('button', { name: 'Eliminar negocio definitivamente' }));
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { name: '¿Eliminar tu negocio para siempre?' })).toBeNull();
    expect(onDeleteBusiness).not.toHaveBeenCalled();
  });
});
