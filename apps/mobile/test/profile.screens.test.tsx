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

const user: User = { id: '1', name: 'Ana Pérez', email: 'ana@correo.com', phone: '573001234567', language: 'es', theme: 'dark', businessId: 'b1', role: 'owner', permissions: [] };

function profile(overrides: Partial<ProfileViewProps> = {}) {
  const props: ProfileViewProps = {
    t,
    user,
    businessName: 'Studio Ana',
    onSaveName: vi.fn(async () => ({ ok: true as const })),
    onRequestPhoneChange: vi.fn(async () => ({ ok: true as const })),
    onConfirmPhoneChange: vi.fn(async () => ({ ok: true as const })),
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
});
