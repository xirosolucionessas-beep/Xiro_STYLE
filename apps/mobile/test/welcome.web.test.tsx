import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { supportMailtoUrl, supportMessage, supportWhatsappUrl, XIRO_CONTACT } from '../src/web/config/contact.web';
import { WelcomeView, type WelcomeViewProps } from '../src/web/screens/Welcome';
import { providerAvailability, SOCIAL_ERROR_KEYS, startSignIn } from '../src/web/services/socialAuth.web';
import { tw } from '../src/web/shell/strings';
import { welcomeEn, welcomeEs } from '../src/web/strings/welcome';

const SRC = path.resolve(__dirname, '../src');

function view(overrides: Partial<WelcomeViewProps> = {}) {
  const props: WelcomeViewProps = {
    language: 'es',
    theme: 'dark',
    t: (key) => tw('es', key),
    logo: (size) => <span data-size={size} />,
    languagePicker: (
      <>
        <button role="radio" aria-checked="true">ES</button>
        <button role="radio" aria-checked="false">EN</button>
      </>
    ),
    onToggleTheme: vi.fn(),
    onLogin: vi.fn(),
    onRegister: vi.fn(),
    onTerms: vi.fn(),
    social: { available: { google: false, apple: false }, busy: null, error: null },
    onSocial: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<WelcomeView {...props} />) };
}

describe('WelcomeView', () => {
  it('has one h1 (the access card), landmarks-safe structure and no axe violations', async () => {
    const { container } = view();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((h) => h.textContent)).toEqual(['Bienvenido a Xiro Style']);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
  });

  it('shows the brand panel content: headline, subtitle and the four value points', () => {
    view();
    expect(screen.getByText('control')).toBeTruthy();
    expect(screen.getByText(/Gestiona citas, clientes, servicios, inventario y caja/)).toBeTruthy();
    const values = within(screen.getByRole('list', { name: 'Lo que puedes hacer con Xiro Style' })).getAllByRole('listitem');
    expect(values.map((li) => li.textContent)).toEqual(['Agenda y citas', 'Clientes y equipo', 'Inventario y catálogo', 'Caja y balance diario']);
  });

  it('navigates from the primary, secondary and terms actions', async () => {
    const { props } = view();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await user.click(screen.getByRole('link', { name: 'Términos y condiciones' }));
    expect(props.onLogin).toHaveBeenCalledOnce();
    expect(props.onRegister).toHaveBeenCalledOnce();
    expect(props.onTerms).toHaveBeenCalledOnce();
  });

  it('toggles the theme with a named icon button that says what it will do', async () => {
    const { props } = view();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cambiar a modo claro' }));
    expect(props.onToggleTheme).toHaveBeenCalledOnce();
  });

  it('marks unavailable social providers as "Próximamente" and never fires them', async () => {
    const { props } = view();
    const google = screen.getByRole('button', { name: /Iniciar sesión con Google/ });
    const apple = screen.getByRole('button', { name: /Iniciar sesión con cuenta de Apple/ });
    for (const button of [google, apple]) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.textContent).toContain('Próximamente');
      await userEvent.setup().click(button);
    }
    expect(props.onSocial).not.toHaveBeenCalled();
  });

  it('fires the provider when available, and shows a busy state that blocks a double submit', async () => {
    const available = view({ social: { available: { google: true, apple: true }, busy: null, error: null } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Iniciar sesión con Google' }));
    expect(available.props.onSocial).toHaveBeenCalledWith('google');
    available.unmount();

    const busy = view({ social: { available: { google: true, apple: true }, busy: 'google', error: null } });
    const button = screen.getByRole('button', { name: /Iniciar sesión con Google/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.xw-spinner')).toBeTruthy();
    expect(button.querySelector('svg')).toBeNull(); // el spinner reemplaza al logo
    await userEvent.setup().click(button);
    expect(busy.props.onSocial).not.toHaveBeenCalled();
  });

  it('announces friendly social errors in a live region', () => {
    view({ social: { available: { google: true, apple: true }, busy: null, error: 'Cancelaste el inicio de sesión. Puedes intentarlo de nuevo.' } });
    expect(screen.getByRole('status').textContent).toContain('Cancelaste');
  });

  it('renders support links from the single contact source (WhatsApp opens in a new tab, email is mailto)', () => {
    view();
    const whatsapp = screen.getByRole('link', { name: /Soporte por WhatsApp: \+57 301 3059562/ });
    expect(whatsapp.getAttribute('href')?.startsWith('https://wa.me/573013059562?text=')).toBe(true);
    expect(decodeURIComponent(whatsapp.getAttribute('href')!)).toContain('Hola Xiro, necesito ayuda con mi cuenta de Xiro Style.');
    expect(whatsapp.getAttribute('target')).toBe('_blank');
    expect(whatsapp.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: /xirosoluciones\.sas@gmail\.com/ }).getAttribute('href')).toBe('mailto:xirosoluciones.sas@gmail.com');
  });

  it('is fully translated to English', () => {
    view({ language: 'en', theme: 'light', t: (key) => tw('en', key) });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to Xiro Style');
    expect(screen.getByRole('button', { name: /Sign in with Apple/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeTruthy();
  });
});

describe('official contact data (single source)', () => {
  it('builds the official WhatsApp and mailto links', () => {
    expect(XIRO_CONTACT).toEqual({ whatsappDisplay: '+57 301 3059562', whatsappDigits: '573013059562', email: 'xirosoluciones.sas@gmail.com' });
    expect(supportWhatsappUrl()).toBe('https://wa.me/573013059562');
    expect(supportWhatsappUrl('a b')).toBe('https://wa.me/573013059562?text=a%20b');
    expect(supportMailtoUrl()).toBe('mailto:xirosoluciones.sas@gmail.com');
    expect(supportMessage('es', 'Studio Ana')).toContain('Studio Ana');
  });

  it('is never hand-written anywhere else in the app source', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const file = path.join(dir, entry);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(tsx?|json)$/.test(entry) && !file.endsWith(path.join('lib', 'contact.ts'))) {
          const text = readFileSync(file, 'utf8');
          if (/3013059562|301 3059562|xirosoluciones/i.test(text)) offenders.push(path.relative(SRC, file));
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

describe('social auth service', () => {
  it('stays "Próximamente" while the backend has no social endpoints, even if the provider is configured', () => {
    const env = { googleClientId: 'x', appleServicesId: 'y', appleRedirectUri: 'https://a.example' };
    expect(providerAvailability('google', env)).toEqual({ available: false, reason: 'backend' });
    expect(providerAvailability('apple', env)).toEqual({ available: false, reason: 'backend' });
  });

  it('requires the public IDs once the backend is ready (Apple needs the Services ID and the return URL)', () => {
    expect(providerAvailability('google', {}, true)).toEqual({ available: false, reason: 'not_configured' });
    expect(providerAvailability('google', { googleClientId: 'x' }, true)).toEqual({ available: true });
    expect(providerAvailability('apple', { appleServicesId: 'y' }, true)).toEqual({ available: false, reason: 'not_configured' });
    expect(providerAvailability('apple', { appleServicesId: 'y', appleRedirectUri: 'https://a.example' }, true)).toEqual({ available: true });
  });

  it('never starts a flow while unavailable and maps every error code to a translated friendly message', async () => {
    expect(await startSignIn('google', 'signin', { googleClientId: 'x' })).toEqual({ ok: false, error: 'unavailable' });
    for (const key of Object.values(SOCIAL_ERROR_KEYS)) {
      expect(tw('es', key), key).not.toBe(key);
      expect(tw('en', key), key).not.toBe(key);
    }
  });
});

describe('welcome strings', () => {
  it('have the same keys in Spanish and English with no empty values', () => {
    expect(Object.keys(welcomeEn).sort()).toEqual(Object.keys(welcomeEs).sort());
    for (const value of [...Object.values(welcomeEs), ...Object.values(welcomeEn)]) expect(value.trim().length).toBeGreaterThan(0);
  });
});
