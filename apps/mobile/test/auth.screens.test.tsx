import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginView, type LoginViewProps } from '../src/web/screens/Login';
import { RecoverView, ResetView, VerifyView } from '../src/web/screens/Recovery';
import { PrivacyView, TermsView } from '../src/web/screens/Legal';
import { RegisterView, type RegisterViewProps } from '../src/web/screens/Register';
import { tw } from '../src/web/shell/strings';
import type { CountryCode } from '../src/web/data/countries';
import { CountryPicker } from '../src/web/ui/CountryPicker';
import { HoursEditor } from '../src/web/ui/HoursEditor';
import { OtpInput } from '../src/web/ui/auth';
import { validatePhotoFile } from '../src/web/ui/PhotoPicker';
import { initialHours } from '../src/web/hours';
import { useState } from 'react';

const t = (key: string) => tw('es', key);
const logo = <span />;
const social = { available: { google: false, apple: false }, busy: null, error: null, notFound: null };

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

// jsdom no implementa matchMedia: por defecto se simula escritorio ancho (CountryPicker/PhoneField usan
// useShellMode para decidir combobox vs. hoja inferior). Los tests de la hoja móvil lo sobrescriben con matches: false.
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => vi.useRealTimers());

/* ---------- Textos: toda clave usada existe en ES y EN ---------- */

describe('web strings coverage', () => {
  it('every literal t("key") used by the web screens resolves in Spanish and English', () => {
    const root = path.resolve(__dirname, '../src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const file = path.join(dir, entry);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.tsx?$/.test(entry) && (file.includes(`${path.sep}web${path.sep}`) || /\.web\.tsx?$/.test(entry))) files.push(file);
      }
    };
    walk(root);
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\('([a-z0-9_]+)'\)/g)) {
        const key = match[1]!;
        for (const language of ['es', 'en'] as const) if (tw(language, key) === key) missing.push(`${path.relative(root, file)}: ${key} (${language})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('dynamic key families exist for every value they can take', () => {
    const families = [...['length', 'upper', 'digit'].map((k) => `pw_rule_${k}`), ...['whatsapp', 'email', 'sms'].map((k) => `verify_sent_${k}`), ...[1, 2, 3].map((n) => `step_name_${n}`), ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`terms_${n}_title`, `terms_${n}_body`, `privacy_${n}_title`, `privacy_${n}_body`]), ...[0, 1, 2, 3, 4, 5, 6].map((d) => `day_${d}`), ...['sign_in_google', 'sign_in_apple', 'sign_up_google', 'sign_up_apple']];
    for (const key of families) for (const language of ['es', 'en'] as const) expect(tw(language, key), `${key} ${language}`).not.toBe(key);
  });
});

/* ---------- Login ---------- */

function login(overrides: Partial<LoginViewProps> = {}) {
  const props: LoginViewProps = {
    t,
    language: 'es',
    logo,
    onSubmit: vi.fn(async () => ({ ok: true })),
    onRecover: vi.fn(),
    onRegister: vi.fn(),
    onBack: vi.fn(),
    social,
    onSocial: vi.fn(),
    onCreateFromSocial: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<LoginView {...props} />) };
}

describe('LoginView', () => {
  it('passes axe and has one h1', async () => {
    const { container } = login();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Acceso seguro']);
    await noViolations(container);
  });

  it('keeps the submit button disabled until both fields are filled, then submits (Remember me on by default)', async () => {
    const { props } = login();
    const user = userEvent.setup();
    const submit = screen.getByRole('button', { name: 'Iniciar sesión' });
    expect(submit.getAttribute('aria-disabled') ?? (submit as HTMLButtonElement).disabled.toString()).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), 'ana@correo.com');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Contraseña', { exact: true }), 'Secreta123');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Recordarme' }) as HTMLInputElement).checked).toBe(true);
    await user.click(submit);
    expect(props.onSubmit).toHaveBeenCalledWith({ identifier: 'ana@correo.com', password: 'Secreta123', remember: true });
  });

  it('passes remember=false when unchecked and shows API errors (general + per field)', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false, general: 'Correo o contraseña incorrectos.', fields: { password: 'Revisa tu contraseña.' } }));
    login({ onSubmit });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), 'ana@correo.com');
    await user.type(screen.getByLabelText('Contraseña', { exact: true }), 'x');
    await user.click(screen.getByRole('checkbox', { name: 'Recordarme' }));
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ remember: false }));
    expect((await screen.findByRole('alert')).textContent).toContain('Correo o contraseña incorrectos.');
    expect(screen.getByText('Revisa tu contraseña.')).toBeTruthy();
  });

  it('reveals the password with a named toggle button', async () => {
    login();
    const user = userEvent.setup();
    const field = screen.getByLabelText('Contraseña', { exact: true });
    expect(field.getAttribute('type')).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(field.getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('links to recovery and sign-up, and shows the "account not found" prompt with a create button', async () => {
    const notFound = { provider: 'google' as const, profile: { name: 'Ana', email: 'ana@gmail.com' } };
    const { props } = login({ social: { ...social, notFound } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' }));
    await user.click(screen.getAllByRole('link', { name: 'Crear cuenta' })[0]!);
    expect(props.onRecover).toHaveBeenCalledOnce();
    expect(props.onRegister).toHaveBeenCalledOnce();
    expect(screen.getByText('No encontramos una cuenta con este correo. ¿Quieres crear una?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(props.onCreateFromSocial).toHaveBeenCalledOnce();
  });

  it('shows the official support links in the footer', () => {
    login();
    expect(screen.getByRole('link', { name: /Soporte por WhatsApp: \+57 301 3059562/ }).getAttribute('href')).toContain('https://wa.me/573013059562');
    expect(screen.getByRole('link', { name: /Soporte por correo/ }).getAttribute('href')).toBe('mailto:xirosoluciones.sas@gmail.com');
  });
});

/* ---------- Registro ---------- */

function register(overrides: Partial<RegisterViewProps> = {}) {
  const props: RegisterViewProps = {
    t,
    language: 'es',
    logo,
    onFinish: vi.fn(async () => ({ status: 'done' as const })),
    onEnterAnyway: vi.fn(async () => undefined),
    onGoLogin: vi.fn(),
    onTerms: vi.fn(),
    onPrivacy: vi.fn(),
    onBackToStart: vi.fn(),
    social,
    onSocial: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<RegisterView {...props} />) };
}

async function fillStep1(user: ReturnType<typeof userEvent.setup>, over: { email?: string; password?: string; confirm?: string; phone?: string } = {}) {
  await user.type(screen.getByLabelText('Nombre completo'), 'Ana Pérez');
  await user.type(screen.getByLabelText('Nombre del negocio'), 'Studio Ana');
  await user.type(screen.getByLabelText('Correo electrónico', { exact: true }), over.email ?? 'ana@correo.com');
  const phone = over.phone ?? '3001234567';
  if (phone) await user.type(screen.getByLabelText('Celular', { exact: true }), phone);
  await user.type(screen.getByLabelText('Contraseña', { exact: true }), over.password ?? 'Secreta123');
  await user.type(screen.getByLabelText('Confirmar contraseña'), over.confirm ?? over.password ?? 'Secreta123');
}
const acceptTerms = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('checkbox', { name: /Acepto los Términos y Condiciones y la Política de Privacidad/ }));
/** Dirección y ciudad son obligatorias en el paso 2: los tests que solo quieren llegar al paso 3 las llenan con esto. */
async function fillStep2Address(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Dirección'), 'Calle 1 # 2-3');
  await user.type(screen.getByLabelText('Ciudad / Departamento'), 'Bogotá');
}

describe('RegisterView', () => {
  it('step 1: passes axe, shows "Paso 1 de 3", social buttons first, and Continue stays disabled until terms are accepted', async () => {
    const { container } = register();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getByText('Paso 1 de 3', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Registrarme con Google/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Registrarme con cuenta de Apple/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(true);
    await noViolations(container);
  });

  it('business type is a labelled radiogroup with the five types', () => {
    register();
    const group = screen.getByRole('radiogroup', { name: 'Tipo de negocio' });
    expect(within(group).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual(['Barbería', 'Salón de belleza', 'Spa', 'Uñas', 'Otro']);
    expect((within(group).getByRole('radio', { name: 'Barbería' }) as HTMLInputElement).checked).toBe(true);
  });

  it('shows the live password rules and validates step 1 with the shared schemas', async () => {
    register();
    const user = userEvent.setup();
    const rules = screen.getByRole('list', { name: '8+ caracteres, mayúscula y número' });
    expect(within(rules).getAllByRole('listitem').every((li) => li.className.includes('is-met'))).toBe(false);
    await user.type(screen.getByLabelText('Contraseña', { exact: true }), 'Secreta1');
    expect(within(rules).getAllByRole('listitem').every((li) => li.className.includes('is-met'))).toBe(true);

    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getAllByText('Este campo es obligatorio.').length).toBeGreaterThan(0);
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy();
    expect(screen.getByText('Paso 1 de 3', { exact: false })).toBeTruthy();
  });

  it('walks the three steps and sends everything to onFinish (country, hours edited, no photo)', async () => {
    const { props } = register();
    const user = userEvent.setup();
    await fillStep1(user);
    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // Paso 2
    expect(await screen.findByRole('heading', { level: 1, name: 'Tu negocio' })).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
    await user.type(screen.getByLabelText('Dirección'), 'Calle 1 # 2-3');
    await user.type(screen.getByLabelText('Ciudad / Departamento'), 'Bogotá');
    await user.click(screen.getByRole('button', { name: 'Editar Lunes a viernes' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar Lunes a viernes' });
    await user.selectOptions(within(dialog).getByLabelText('Hora de apertura: Hora'), '08');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(screen.getAllByText('08:00 — 19:00').length).toBe(3); // con el interruptor activo cambia toda la semana
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // Paso 3
    expect(await screen.findByRole('heading', { level: 1, name: 'Personaliza tu negocio' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Omitir por ahora' }));
    await waitFor(() => expect(props.onFinish).toHaveBeenCalledOnce());
    const data = vi.mocked(props.onFinish).mock.calls[0]![0];
    expect(data.photo).toBeNull();
    expect(data.step1).toMatchObject({ name: 'Ana Pérez', businessName: 'Studio Ana', email: 'ana@correo.com', businessType: 'barbershop', accepted: true });
    expect(data.step2).toMatchObject({ address: 'Calle 1 # 2-3', city: 'Bogotá', country: 'CO' });
    expect(data.step2.hours.days.every((d) => d.from === '08:00')).toBe(true);
  }, 30_000); // recorre tres pasos con muchos clics: bajo carga de la suite completa superaba los 5 s por defecto

  it('el celular solo acepta números: filtra letras, símbolos y espacios mientras se escribe o se pega', async () => {
    register();
    const user = userEvent.setup();
    const phone = screen.getByLabelText('Celular', { exact: true }) as HTMLInputElement;
    await user.type(phone, '30a0 1-2.3x');
    expect(phone.value).toBe('300123');
    await user.clear(phone);
    await user.click(phone);
    await user.paste('+57 (300) 123-4567 ext');
    expect(phone.value).toBe('573001234567');
    expect(phone.getAttribute('inputmode')).toBe('numeric');
    expect(phone.getAttribute('aria-required')).toBe('true');
  });

  it('sin celular no se puede continuar y muestra el mensaje claro; se limpia al escribir', async () => {
    register();
    const user = userEvent.setup();
    await fillStep1(user, { phone: '' });
    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Paso 1 de 3', { exact: false })).toBeTruthy(); // no avanzó
    expect(screen.getByText('El número de celular es obligatorio y debe contener solo números.')).toBeTruthy();
    expect(screen.getByLabelText('Celular', { exact: true }).getAttribute('aria-invalid')).toBe('true');
    await user.type(screen.getByLabelText('Celular', { exact: true }), '3001234567');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tu negocio' })).toBeTruthy();
  });

  it('the phone field has its own country/dial selector, independent from the business address country (step 2)', async () => {
    const { props } = register();
    const user = userEvent.setup();
    const phoneBox = screen.getByRole('combobox', { name: /Celular/ });
    expect(phoneBox.textContent).toContain('+57'); // Colombia por defecto
    await user.click(phoneBox);
    const list = screen.getByRole('listbox', { name: 'Celular' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toContain('México+52');
    await user.click(within(list).getByRole('option', { name: /México/ }));
    expect(screen.getByRole('combobox', { name: /Celular/ }).textContent).toContain('+52');

    await fillStep1(user);
    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { level: 1, name: 'Tu negocio' });
    await fillStep2Address(user);
    // El país del negocio (paso 2) sigue en su propio valor por defecto: no se acopla al país del celular.
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { level: 1, name: 'Personaliza tu negocio' });
    await user.click(screen.getByRole('button', { name: 'Omitir por ahora' }));
    await waitFor(() => expect(props.onFinish).toHaveBeenCalledOnce());
    const data = vi.mocked(props.onFinish).mock.calls[0]![0];
    expect(data.phoneDial).toBe('52');
    expect(data.step2.country).toBe('CO');
  });

  it('step 2: blocks "Continuar" with empty address/city, shows required errors, focuses the first one, and clears on typing', async () => {
    const { props } = register();
    const user = userEvent.setup();
    await fillStep1(user);
    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { level: 1, name: 'Tu negocio' });

    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Tu negocio' })).toBeTruthy(); // no avanzó al paso 3
    expect(screen.getAllByText('Este campo es obligatorio.').length).toBe(2); // dirección y ciudad
    const addressInput = screen.getByLabelText('Dirección');
    expect(document.activeElement).toBe(addressInput);
    expect(props.onFinish).not.toHaveBeenCalled();

    await user.type(addressInput, 'C');
    // El error desaparece de inmediato al escribir, antes de volver a intentar Continuar.
    await waitFor(() => expect(screen.queryAllByText('Este campo es obligatorio.').length).toBeLessThan(2));

    await user.type(addressInput, 'alle 1 # 2-3');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    // La ciudad sigue vacía: bloquea otra vez y enfoca la ciudad esta vez (ya no la dirección).
    expect(screen.getByRole('heading', { level: 1, name: 'Tu negocio' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Ciudad / Departamento'));

    await user.type(screen.getByLabelText('Ciudad / Departamento'), 'Bogotá');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Personaliza tu negocio' })).toBeTruthy();
  });

  it('"Volver" keeps what was typed and moves focus to the step title', async () => {
    register();
    const user = userEvent.setup();
    await fillStep1(user);
    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { level: 1, name: 'Tu negocio' });
    await user.click(screen.getByRole('button', { name: 'Volver' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Crea tu cuenta' });
    expect(document.activeElement).toBe(heading);
    expect((screen.getByLabelText('Nombre del negocio') as HTMLInputElement).value).toBe('Studio Ana');
  });

  it('a duplicate email from the API sends the person back to step 1 with the message on the field', async () => {
    const onFinish = vi.fn(async () => ({ status: 'failed' as const, fields: { email: 'Ese correo ya está registrado.' }, general: undefined }));
    register({ onFinish });
    const user = userEvent.setup();
    await fillStep1(user);
    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { level: 1, name: 'Tu negocio' });
    await fillStep2Address(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByRole('button', { name: 'Finalizar y entrar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Crea tu cuenta' })).toBeTruthy();
    expect(screen.getByText('Ese correo ya está registrado.')).toBeTruthy();
  });

  it('when only the business/photo step failed, offers Retry and "Continuar sin guardar" (never re-registers)', async () => {
    const onFinish = vi.fn(async () => ({ status: 'partial' as const, failed: 'business' as const }));
    const { props } = register({ onFinish });
    const user = userEvent.setup();
    await fillStep1(user);
    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { level: 1, name: 'Tu negocio' });
    await fillStep2Address(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByRole('button', { name: 'Finalizar y entrar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Tu cuenta ya se creó, pero no pudimos guardar los datos del negocio.');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onFinish).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Continuar sin guardar' }));
    expect(props.onEnterAnyway).toHaveBeenCalledOnce();
  });

  it('with a Google/Apple seed it prefills name and email, hides password fields and does not ask for a password', async () => {
    const { props } = register({ seed: { provider: 'google', name: 'Ana Gómez', email: 'ana@gmail.com' } });
    const user = userEvent.setup();
    expect((screen.getByLabelText('Nombre completo') as HTMLInputElement).value).toBe('Ana Gómez');
    expect((screen.getByLabelText('Correo electrónico', { exact: true }) as HTMLInputElement).value).toBe('ana@gmail.com');
    expect(screen.queryByLabelText('Contraseña', { exact: true })).toBeNull();
    await user.type(screen.getByLabelText('Nombre del negocio'), 'Studio Ana');
    await user.type(screen.getByLabelText('Celular', { exact: true }), '3001234567'); // el celular es obligatorio también con cuenta social
    await acceptTerms(user);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tu negocio' })).toBeTruthy();
    expect(props.onFinish).not.toHaveBeenCalled();
  });

  it('Terms and Privacy are separate links to separate pages, and the login link is available', async () => {
    const { props } = register();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Términos y Condiciones' }));
    expect(props.onTerms).toHaveBeenCalledOnce();
    expect(props.onPrivacy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Política de Privacidad' }));
    expect(props.onPrivacy).toHaveBeenCalledOnce();
    expect(props.onTerms).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('link', { name: 'Iniciar sesión' }));
    expect(props.onGoLogin).toHaveBeenCalledOnce();
  });
});

/* ---------- Componentes ---------- */

describe('CountryPicker', () => {
  function Harness() {
    const [value, setValue] = useState<CountryCode>('CO');
    return <CountryPicker label="País" value={value} onChange={setValue} sheetSearchPlaceholder="Buscar país o prefijo" sheetCloseLabel="Cerrar" sheetNoResultsLabel="No encontramos ese país." />;
  }

  it('is a labelled combobox showing the real flag, name and prefix; opens a listbox with the nine countries', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const box = screen.getByRole('combobox', { name: 'País' });
    expect(box.textContent).toContain('Colombia');
    expect(box.textContent).toContain('+57');
    expect(box.querySelector('svg')).toBeTruthy();
    await user.click(box);
    const list = screen.getByRole('listbox', { name: 'País' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Colombia+57', 'México+52', 'United States+1', 'Canadá+1', 'España+34', 'Argentina+54', 'Chile+56', 'Perú+51', 'Ecuador+593']);
    expect(within(list).getByRole('option', { name: /Colombia/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('works with the keyboard: arrows move, Enter chooses, Escape closes, letters jump', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const box = screen.getByRole('combobox', { name: 'País' });
    box.focus();
    await user.keyboard('{ArrowDown}');
    expect(box.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('combobox', { name: 'País' }).textContent).toContain('México');
    await user.keyboard('e'); // salta a España
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'País' }).textContent).toContain('España');
    await user.keyboard('{ArrowUp}{Escape}');
    expect(screen.getByRole('combobox', { name: 'País' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('on mobile, opens a bottom sheet with a search box instead of the inline dropdown', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<Harness />);
    const user = userEvent.setup();
    const box = screen.getByRole('button', { name: 'País' });
    expect(box.getAttribute('role')).not.toBe('combobox'); // en móvil no es un combobox ARIA: abre un diálogo
    await user.click(box);

    const dialog = await screen.findByRole('dialog', { name: 'País' });
    const countryOption = (name: RegExp) => within(dialog).getAllByRole('button', { name });
    expect(countryOption(/\+\d/).length).toBe(9); // las nueve opciones (todas muestran "+<prefijo>"), como botones normales
    const search = within(dialog).getByRole('searchbox', { name: 'Buscar país o prefijo' });
    await user.type(search, 'méxico');
    const options = countryOption(/\+\d/);
    expect(options.length).toBe(1);
    expect(options[0]!.textContent).toContain('México');
    await user.click(options[0]!);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'País' }).textContent).toContain('México');
  });

  it('on mobile, the search ignores accents (typing "mexico" without an accent still finds "México")', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'País' }));
    const dialog = await screen.findByRole('dialog', { name: 'País' });
    await user.type(within(dialog).getByRole('searchbox'), 'mexico');
    const options = within(dialog).getAllByRole('button', { name: /\+\d/ });
    expect(options.length).toBe(1);
    expect(options[0]!.textContent).toContain('México');
  });

  it('on mobile, shows a "no results" message for a search that matches nothing', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'País' }));
    const dialog = await screen.findByRole('dialog', { name: 'País' });
    await user.type(within(dialog).getByRole('searchbox'), 'Narnia');
    expect(within(dialog).getByText('No encontramos ese país.')).toBeTruthy();
  });
});

describe('HoursEditor', () => {
  function Harness({ start = initialHours() }) {
    const [hours, setHours] = useState(start);
    return <HoursEditor hours={hours} onChange={setHours} t={t} />;
  }

  it('shows three grouped rows, and seven when the "same hours" switch is turned off', async () => {
    const { container } = render(<Harness />);
    const user = userEvent.setup();
    const list = screen.getByRole('list', { name: 'Horario de atención' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Lunes a viernes09:00 — 19:00', 'Sábado09:00 — 19:00', 'Domingo09:00 — 19:00']);
    const toggle = screen.getByRole('switch', { name: 'Aplicar el mismo horario todos los días' });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    await noViolations(container);
    await user.click(toggle);
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
  });

  it('edits one day when the switch is off and can mark it closed', async () => {
    render(<Harness start={{ ...initialHours(), sameEveryDay: false }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Editar Domingo' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar Domingo' });
    await user.click(within(dialog).getByRole('switch', { name: 'Este día está abierto' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    const list = screen.getByRole('list', { name: 'Horario de atención' });
    expect(within(list).getAllByRole('listitem').at(-1)!.textContent).toBe('DomingoCerrado');
    expect(within(list).getAllByRole('listitem')[0]!.textContent).toContain('09:00 — 19:00');
  });

  it('refuses a closing time that is not after the opening time and keeps the dialog open', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Editar Sábado' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Hora de cierre: Hora'), '07');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(dialog).getByText('El cierre debe ser posterior a la apertura.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText('09:00 — 19:00')).toHaveLength(3);
  });
});

describe('OtpInput', () => {
  function Harness({ onValue }: { onValue?: (v: string) => void }) {
    const [value, setValue] = useState('');
    return <OtpInput value={value} onChange={(v) => (setValue(v), onValue?.(v))} label="Código de verificación" digitLabel={(i, n) => `Dígito ${i} / ${n}`} />;
  }

  it('has six labelled boxes with numeric keypad and one-time-code autocomplete on the first', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Código de verificación' });
    const boxes = within(group).getAllByRole('textbox');
    expect(boxes).toHaveLength(6);
    expect(boxes[0]!.getAttribute('autocomplete')).toBe('one-time-code');
    expect(boxes.every((b) => b.getAttribute('inputmode') === 'numeric')).toBe(true);
    expect(boxes[2]!.getAttribute('aria-label')).toBe('Dígito 3 / 6');
    expect(document.activeElement).toBe(boxes[0]);
  });

  it('auto-advances while typing, ignores letters, and Backspace goes back', async () => {
    const values: string[] = [];
    render(<Harness onValue={(v) => values.push(v)} />);
    const user = userEvent.setup();
    const boxes = screen.getAllByRole('textbox');
    await user.keyboard('1a2');
    expect(values.at(-1)).toBe('12');
    expect(document.activeElement).toBe(boxes[2]);
    await user.keyboard('{Backspace}');
    expect(document.activeElement).toBe(boxes[1]);
    expect(values.at(-1)).toBe('1');
  });

  it('distributes a pasted code across the boxes (also with spaces) and focuses the last', async () => {
    const values: string[] = [];
    render(<Harness onValue={(v) => values.push(v)} />);
    const boxes = screen.getAllByRole('textbox');
    boxes[0]!.focus();
    fireEvent.paste(boxes[0]!, { clipboardData: { getData: () => '123 456' } });
    expect(values.at(-1)).toBe('123456');
    expect(document.activeElement).toBe(boxes[5]);
  });
});

/* ---------- Recuperación ---------- */

describe('RecoverView', () => {
  const setup = (onSubmit = vi.fn(async () => ({ ok: true }))) => {
    const onBack = vi.fn();
    const utils = render(<RecoverView t={t} language="es" logo={logo} onSubmit={onSubmit} onBack={onBack} />);
    return { onSubmit, onBack, ...utils };
  };

  it('offers WhatsApp, email and SMS as radio cards (WhatsApp selected) and passes axe', async () => {
    const { container } = setup();
    const group = screen.getByRole('radiogroup', { name: '¿Cómo quieres recibir el código?' });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['whatsapp', 'email', 'sms']);
    expect((within(group).getByRole('radio', { name: /WhatsApp/ }) as HTMLInputElement).checked).toBe(true);
    await noViolations(container);
  });

  it('el canal lo elige la persona (no se adivina por lo escrito): cambiarlo limpia el campo, y cada canal enmascara lo propio', async () => {
    setup();
    const user = userEvent.setup();
    // Canal por defecto: WhatsApp — solo admite dígitos, letras y símbolos se descartan al escribir.
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), 'abc300-123 4542xyz');
    expect(screen.getAllByText('3•• ••• ••42').length).toBe(2); // WhatsApp y SMS comparten la pista
    // Cambiar a Correo limpia el campo (y con él, la máscara de teléfono).
    await user.click(screen.getByRole('radio', { name: /Correo/ }));
    expect((screen.getByLabelText('Correo electrónico o teléfono') as HTMLInputElement).value).toBe('');
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), 'santiago@correo.com');
    expect(screen.getByText('sa••••@correo.com')).toBeTruthy();
  });

  it('valida el identificador según el canal elegido, envía el canal correcto, y enlaza a soporte y volver a iniciar sesión', async () => {
    const { onSubmit, onBack } = setup();
    const user = userEvent.setup();
    // WhatsApp (por defecto): sin dígitos suficientes, el botón permanece deshabilitado — ni se intenta enviar.
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), 'no-valido');
    expect((screen.getByRole('button', { name: 'Enviar código' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: /Correo/ }));
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), 'ana@correo.com');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(onSubmit).toHaveBeenCalledWith({ identifier: 'ana@correo.com', channel: 'email' });
    expect(screen.getByRole('link', { name: /Soporte por WhatsApp/ })).toBeTruthy();
    expect(screen.getByText('¿No tienes acceso a ninguno? Contacta a soporte')).toBeTruthy();
    expect(screen.getByText(/Si te registraste con Google o con tu cuenta de Apple/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('en WhatsApp/SMS solo admite un celular colombiano válido; en Correo, una sintaxis de correo válida', async () => {
    setup();
    const user = userEvent.setup();
    const submit = screen.getByRole('button', { name: 'Enviar código' }) as HTMLButtonElement;
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), '2001234567'); // no empieza en 3
    expect(submit.disabled).toBe(true);
    await user.clear(screen.getByLabelText('Correo electrónico o teléfono'));
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), '3001234567');
    expect(submit.disabled).toBe(false);
    await user.click(screen.getByRole('radio', { name: /Correo/ }));
    await user.type(screen.getByLabelText('Correo electrónico o teléfono'), 'correo-sin-arroba.com');
    expect(submit.disabled).toBe(true);
  });
});

describe('VerifyView', () => {
  const setup = (over: Partial<Parameters<typeof VerifyView>[0]> = {}) => {
    const props = { t, language: 'es' as const, logo, channel: 'whatsapp' as const, onVerify: vi.fn(async () => ({ ok: true })), onResend: vi.fn(async () => ({ ok: true })), onChangeMethod: vi.fn(), onBack: vi.fn(), ...over };
    return { props, ...render(<VerifyView {...props} />) };
  };

  it('mentions the chosen channel, keeps "Entrar" disabled until six digits and then verifies', async () => {
    const { props, container } = setup();
    expect(screen.getByText('Enviamos un código de 6 dígitos por WhatsApp')).toBeTruthy();
    const enter = screen.getByRole('button', { name: 'Entrar a Xiro Style' }) as HTMLButtonElement;
    expect(enter.disabled).toBe(true);
    await noViolations(container);
    const user = userEvent.setup();
    await user.keyboard('12345');
    expect(enter.disabled).toBe(true);
    await user.keyboard('6');
    expect(enter.disabled).toBe(false);
    await user.click(enter);
    expect(props.onVerify).toHaveBeenCalledWith('123456');
  });

  it('shows the API error under the boxes, and the change-method and back actions work', async () => {
    const { props } = setup({ onVerify: vi.fn(async () => ({ ok: false, fields: { code: 'Código incorrecto o vencido.' } })) });
    const user = userEvent.setup();
    await user.keyboard('123456');
    await user.click(screen.getByRole('button', { name: 'Entrar a Xiro Style' }));
    expect((await screen.findAllByRole('alert')).some((a) => a.textContent?.includes('Código incorrecto o vencido.'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Cambiar método de verificación' }));
    await user.click(screen.getByRole('button', { name: 'Volver al inicio de sesión' }));
    expect(props.onChangeMethod).toHaveBeenCalledOnce();
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it('counts down the resend timer (00:58 → link) without announcing every second, then resends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { props } = setup();
    expect(screen.getByText('01:00')).toBeTruthy();
    // Cada segundo es un temporizador nuevo (un render por tick): se avanza de uno en uno.
    const tick = async (seconds: number) => {
      for (let i = 0; i < seconds; i += 1) await act(async () => void vi.advanceTimersByTime(1000));
    };
    await tick(2);
    expect(screen.getByText('00:58')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reenviar código' })).toBeNull();
    for (const status of screen.getAllByRole('status')) expect(status.textContent).not.toMatch(/\d\d:\d\d/);
    await tick(58);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(props.onResend).toHaveBeenCalledOnce();
    expect(await screen.findByText('Te enviamos un código nuevo.')).toBeTruthy();
    expect(screen.getByText('01:00', { exact: false })).toBeTruthy();
  });

  it('marks the development code clearly when the API returns it', () => {
    setup({ devCode: '123456' });
    expect(screen.getByText(/Solo desarrollo: tu código es/).textContent).toContain('123456');
  });
});

describe('ResetView', () => {
  it('validates live (rules + strength meter), requires matching passwords and submits', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true }));
    const { container } = render(<ResetView t={t} language="es" logo={logo} onSubmit={onSubmit} onBack={vi.fn()} />);
    const user = userEvent.setup();
    expect(screen.getByText('Tu identidad fue verificada. Elige una contraseña segura para tu cuenta.')).toBeTruthy();
    const meter = screen.getByRole('meter', { name: 'Fortaleza de la contraseña' });
    expect(meter.getAttribute('aria-valuetext')).toBe('Sin contraseña');
    await user.type(screen.getByLabelText('Contraseña', { exact: true }), 'Secreta123');
    expect(meter.getAttribute('aria-valuetext')).toBe('Aceptable');
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'Otra1234');
    await user.click(screen.getByRole('button', { name: 'Guardar y entrar' }));
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Confirmar contraseña'));
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'Secreta123');
    await user.click(screen.getByRole('button', { name: 'Guardar y entrar' }));
    expect(onSubmit).toHaveBeenCalledWith({ password: 'Secreta123' });
    await noViolations(container);
  });
});

/* ---------- Términos y Privacidad (páginas independientes) ---------- */

describe('TermsView', () => {
  it('has six numbered sections plus a contact card, official contact links, a fixed back button, and passes axe', async () => {
    const onBack = vi.fn();
    const { container } = render(<TermsView t={t} language="es" onBack={onBack} />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Términos y condiciones']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Aceptación y alcance',
      'Descripción del servicio y licencia de software (SaaS)',
      'Planes y renovación de suscripciones',
      'Registro de clientes, citas y datos del negocio',
      'Reglas del servicio y uso aceptable',
      'Disponibilidad, cambios y responsabilidad',
      'Contacto',
    ]);
    expect(screen.getByText(/renueva automáticamente/)).toBeTruthy();
    const contactCard = screen.getByRole('heading', { level: 2, name: 'Contacto' }).parentElement!;
    expect(within(contactCard).getByRole('link', { name: /\+57 301 3059562/ }).getAttribute('href')).toContain('https://wa.me/573013059562');
    expect(within(contactCard).getByRole('link', { name: /xirosoluciones\.sas@gmail\.com/ }).getAttribute('href')).toBe('mailto:xirosoluciones.sas@gmail.com');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Volver al registro' }));
    expect(onBack).toHaveBeenCalledOnce();
    await noViolations(container);
  });

  it('is fully translated', () => {
    render(<TermsView t={(key) => tw('en', key)} language="en" onBack={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Terms and conditions');
    expect(screen.getByRole('button', { name: 'Back to sign-up' })).toBeTruthy();
  });
});

describe('PrivacyView', () => {
  it('has six numbered sections plus a contact card covering personal data, Google/Apple, security and ARCO rights, and passes axe', async () => {
    const onBack = vi.fn();
    const { container } = render(<PrivacyView t={t} language="es" onBack={onBack} />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Política de privacidad']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Responsable del tratamiento',
      'Datos que recopilamos',
      'Datos al iniciar sesión con Google o Apple',
      'Finalidad del tratamiento',
      'Medidas de seguridad de la información',
      'Tus derechos (ARCO)',
      'Canal de contacto oficial',
    ]);
    expect(screen.getByText(/Acceso, Rectificación, Cancelación/)).toBeTruthy();
    const contactCard = screen.getByRole('heading', { level: 2, name: 'Canal de contacto oficial' }).parentElement!;
    expect(within(contactCard).getByRole('link', { name: /\+57 301 3059562/ }).getAttribute('href')).toContain('https://wa.me/573013059562');
    expect(within(contactCard).getByRole('link', { name: /xirosoluciones\.sas@gmail\.com/ }).getAttribute('href')).toBe('mailto:xirosoluciones.sas@gmail.com');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Volver al registro' }));
    expect(onBack).toHaveBeenCalledOnce();
    await noViolations(container);
  });

  it('is fully translated', () => {
    render(<PrivacyView t={(key) => tw('en', key)} language="en" onBack={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Privacy policy');
  });
});

/* ---------- Foto ---------- */

describe('photo file validation', () => {
  it('accepts images and rejects other types and huge files', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(validatePhotoFile({ type: 'image/webp', size: 1000 })).toBeNull();
    expect(validatePhotoFile({ type: 'application/pdf', size: 1000 })).toBe('photo_type');
    expect(validatePhotoFile({ type: 'image/gif', size: 1000 })).toBe('photo_type');
    expect(validatePhotoFile({ type: 'image/png', size: 25 * 1024 * 1024 })).toBe('photo_size');
  });
});
