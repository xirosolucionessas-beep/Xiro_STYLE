import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { acceptConsent, acceptedKey, markNewAccount, needsConsent, PENDING_KEY, type ConsentStore } from '../src/lib/cookieConsent';
import { runRegistration, type RegistrationDeps } from '../src/lib/registration';
import { CookieConsentView } from '../src/web/ui/CookieConsent';
import { tw } from '../src/web/shell/strings';

function memoryStore(initial: Record<string, string> = {}): ConsentStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  };
}

const broken: ConsentStore = {
  get: async () => Promise.reject(new Error('storage')),
  set: async () => Promise.reject(new Error('storage')),
  remove: async () => Promise.reject(new Error('storage')),
};

describe('consentimiento de cookies: cuándo se muestra', () => {
  it('solo a una cuenta recién creada en este dispositivo', async () => {
    const store = memoryStore();
    expect(await needsConsent(store, 'u1')).toBe(false); // inició sesión con una cuenta existente
    await markNewAccount(store, 'u1');
    expect(await needsConsent(store, 'u1')).toBe(true);
    expect(await needsConsent(store, 'u2')).toBe(false); // otra cuenta en el mismo dispositivo no lo ve
  });

  it('al aceptar se guarda con fecha y NUNCA vuelve a mostrarse, ni al iniciar sesión otra vez', async () => {
    const store = memoryStore();
    await markNewAccount(store, 'u1');
    await acceptConsent(store, 'u1', new Date('2026-09-25T10:00:00Z'));
    expect(JSON.parse(store.data.get(acceptedKey('u1'))!)).toEqual({ acceptedAt: '2026-09-25T10:00:00.000Z' });
    expect(store.data.has(PENDING_KEY)).toBe(false);
    expect(await needsConsent(store, 'u1')).toBe(false);
    // Aunque algo volviera a marcarla como nueva, el consentimiento ya dado manda.
    await markNewAccount(store, 'u1');
    expect(await needsConsent(store, 'u1')).toBe(false);
  });

  it('si el almacenamiento falla, no se muestra y nada se rompe', async () => {
    await expect(markNewAccount(broken, 'u1')).resolves.toBeUndefined();
    expect(await needsConsent(broken, 'u1')).toBe(false);
    await expect(acceptConsent(broken, 'u1')).resolves.toBeUndefined();
  });
});

describe('el registro marca la cuenta nueva', () => {
  const session = { accessToken: 'a', refreshToken: 'r', user: { id: 'u1' }, business: { id: 'b1' } } as never;
  const input = { payload: {} as never, business: {} as never, photo: null };
  const deps = (over: Partial<RegistrationDeps> = {}): RegistrationDeps => ({
    register: vi.fn(async () => session),
    authorize: vi.fn(),
    updateBusiness: vi.fn(async () => ({}) as never),
    uploadLogo: vi.fn(async () => ({}) as never),
    signIn: vi.fn(async () => undefined),
    ...over,
  });

  it('avisa una sola vez, en cuanto la cuenta existe (aunque un paso posterior falle o se reintente)', async () => {
    const onRegistered = vi.fn();
    const d = deps({ onRegistered, updateBusiness: vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({} as never) });
    const first = await runRegistration(input, d);
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(onRegistered).toHaveBeenCalledWith(session);
    if (first.status !== 'partial') throw new Error('unreachable');
    await runRegistration(input, d, first.progress);
    expect(onRegistered).toHaveBeenCalledTimes(1);
  });

  it('un registro fallido no marca nada, y un error al marcar no frena la cuenta', async () => {
    const onRegistered = vi.fn();
    await runRegistration(input, deps({ onRegistered, register: vi.fn(async () => Promise.reject(new Error('email_exists'))) }));
    expect(onRegistered).not.toHaveBeenCalled();
    const d = deps({ onRegistered: vi.fn(async () => Promise.reject(new Error('storage'))) });
    expect(await runRegistration(input, d)).toEqual({ status: 'done' });
    expect(d.signIn).toHaveBeenCalled();
  });
});

const t = (key: string) => tw('es', key);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

describe('CookieConsentView', () => {
  const view = (open = true) => {
    const props = { open, t, onAccept: vi.fn(), navigate: vi.fn() };
    return { props, ...render(<CookieConsentView {...props} />) };
  };

  it('es un diálogo con título y mensaje, recibe el foco en "Entendido y Aceptar" y pasa axe', async () => {
    const { container } = view();
    const dialog = screen.getByRole('dialog', { name: 'Tu privacidad importa' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(dialog.textContent).toContain('Usamos cookies para optimizar tu experiencia');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Entendido y Aceptar' }));
    await noViolations(container);
  });

  it('aceptar avisa una vez', async () => {
    const { props } = view();
    await userEvent.click(screen.getByRole('button', { name: 'Entendido y Aceptar' }));
    expect(props.onAccept).toHaveBeenCalledOnce();
  });

  it('enlaza a Términos y Privacidad sin recargar, pero deja abrirlos en otra pestaña', async () => {
    const { props } = view();
    const terms = screen.getByRole('link', { name: 'Términos y Condiciones' });
    const privacy = screen.getByRole('link', { name: 'Política de Privacidad' });
    expect(terms.getAttribute('href')).toBe('/terms');
    expect(privacy.getAttribute('href')).toBe('/privacy');
    await userEvent.click(terms);
    await userEvent.click(privacy);
    expect(props.navigate).toHaveBeenNthCalledWith(1, '/terms');
    expect(props.navigate).toHaveBeenNthCalledWith(2, '/privacy');
    props.navigate.mockClear();
    fireEvent.click(terms, { ctrlKey: true });
    expect(props.navigate).not.toHaveBeenCalled();
  });

  it('cerrado no pinta nada', () => {
    view(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('existe en inglés', () => {
    render(<CookieConsentView open t={(key) => tw('en', key)} onAccept={vi.fn()} navigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Understood and Accept' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeTruthy();
  });
});
