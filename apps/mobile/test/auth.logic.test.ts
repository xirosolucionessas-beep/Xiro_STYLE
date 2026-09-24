import { defaultBusinessHours, type AuthSession, type Business, type User } from '@xiro/shared';
import { describe, expect, it, vi } from 'vitest';
import { COUNTRIES, composePhone, countryByCode } from '../src/web/data/countries';
import { applyRowChange, hasHoursErrors, initialHours, minuteOptions, rowsOf, setSameEveryDay, validateDay } from '../src/web/hours';
import { maskEmail, maskPhone } from '../src/web/mask';
import { cleanOtp, formatCountdown, pasteInto } from '../src/web/otp';
import { scaledSize } from '../src/web/services/imageUpload.web';
import { passwordRuleStatus, passwordStrength } from '../src/web/password';
import { buildBusinessUpdate, buildRegisterPayload, enterWithProgress, runRegistration, validateStep1, validateStep2, type RegistrationDeps, type Step1Values, type Step2Values } from '../src/web/registration';

const step1 = (over: Partial<Step1Values> = {}): Step1Values => ({
  name: 'Ana Pérez',
  businessName: 'Studio Ana',
  businessType: 'barbershop',
  email: 'ana@correo.com',
  phone: '',
  password: 'Secreta123',
  confirm: 'Secreta123',
  accepted: true,
  language: 'es',
  ...over,
});

describe('countries and phone', () => {
  it('lists the nine countries with prefix and currency the API supports', () => {
    expect(COUNTRIES.map((c) => c.code)).toEqual(['CO', 'MX', 'US', 'CA', 'ES', 'AR', 'CL', 'PE', 'EC']);
    expect(countryByCode('MX')).toMatchObject({ dial: '52', currency: 'MXN' });
    expect(countryByCode('ES')).toMatchObject({ dial: '34', currency: 'EUR' });
    expect(countryByCode('CA')).toMatchObject({ dial: '1' });
    // Ecuador ya usa USD como moneda real (no es una aproximación): sin currencyIsFallback.
    const ecuador = countryByCode('EC');
    expect(ecuador).toMatchObject({ dial: '593', currency: 'USD' });
    expect(ecuador.currencyIsFallback).toBeUndefined();
    // La API solo admite COP/USD/MXN/EUR: AR/CL/PE/CA usan USD y quedan marcados como aproximación.
    for (const code of ['AR', 'CL', 'PE', 'CA'] as const) expect(countryByCode(code)).toMatchObject({ currency: 'USD', currencyIsFallback: true });
  });

  it('prepends the country prefix unless the number already has it', () => {
    expect(composePhone('300 123 4567', '57')).toBe('573001234567');
    expect(composePhone('573001234567', '57')).toBe('573001234567');
    expect(composePhone('(555) 123-4567', '1')).toBe('15551234567');
    expect(composePhone('0155512345', '52')).toBe('52155512345');
    expect(composePhone('', '57')).toBe('');
  });
});

describe('business hours editor logic', () => {
  it('starts as "same every day", open all week, shown as three grouped rows', () => {
    const hours = initialHours();
    expect(hours.sameEveryDay).toBe(true);
    expect(hours.days.every((d) => d.open && d.from === '09:00' && d.to === '19:00')).toBe(true);
    expect(rowsOf(hours).map((r) => r.id)).toEqual(['weekdays', 'saturday', 'sunday']);
  });

  it('with the switch on, editing any row updates every day', () => {
    const hours = initialHours();
    const next = applyRowChange(hours, rowsOf(hours)[1]!, { from: '08:00', to: '17:30' });
    expect(next.days.every((d) => d.from === '08:00' && d.to === '17:30')).toBe(true);
  });

  it('with the switch off it breaks out Monday…Sunday and edits only that day (or Monday–Friday for the grouped row)', () => {
    const off = setSameEveryDay(initialHours(), false);
    const rows = rowsOf(off);
    expect(rows.map((r) => r.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    const sunday = applyRowChange(off, rows[6]!, { open: false });
    expect(sunday.days.find((d) => d.day === 0)!.open).toBe(false);
    expect(sunday.days.filter((d) => d.open)).toHaveLength(6);
    const weekdays = applyRowChange({ ...off, sameEveryDay: false }, { id: 'weekdays', day: 1, open: true, from: '', to: '' }, { from: '10:00' });
    expect(weekdays.days.filter((d) => d.from === '10:00').map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it('turning the switch on copies the first open day to all days (like the native editor)', () => {
    const custom = { sameEveryDay: false, days: defaultBusinessHours().days.map((d) => ({ ...d, open: d.day !== 1, from: d.day === 2 ? '07:00' : '09:00', to: d.day === 2 ? '15:00' : '19:00' })) };
    const on = setSameEveryDay(custom, true);
    expect(on.days.every((d) => d.open && d.from === '07:00' && d.to === '15:00')).toBe(true);
  });

  it('requires closing after opening, only on open days', () => {
    expect(validateDay({ open: true, from: '09:00', to: '09:00' })).toBe('hours_close_after_open');
    expect(validateDay({ open: true, from: '19:00', to: '09:00' })).toBe('hours_close_after_open');
    expect(validateDay({ open: true, from: '09:00', to: '09:05' })).toBeNull();
    expect(validateDay({ open: false, from: '19:00', to: '09:00' })).toBeNull();
    expect(hasHoursErrors(applyRowChange(initialHours(), rowsOf(initialHours())[0]!, { from: '20:00' }))).toBe(true);
  });

  it('keeps an off-grid minute available in the 5-minute picker', () => {
    expect(minuteOptions()).toHaveLength(12);
    expect(minuteOptions('07')).toContain('07');
  });
});

describe('password rules', () => {
  it('reports each rule live and a strength that grows with length and variety', () => {
    expect(passwordRuleStatus('abc')).toEqual([{ id: 'length', met: false }, { id: 'upper', met: false }, { id: 'digit', met: false }]);
    expect(passwordRuleStatus('Secreta1').every((r) => r.met)).toBe(true);
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(1);
    expect(passwordStrength('Secreta1')).toBe(2);
    expect(passwordStrength('Secreta123456')).toBe(3);
    expect(passwordStrength('Secreta123456!')).toBe(4);
  });
});

describe('masking and OTP helpers', () => {
  it('masks only what the person typed', () => {
    expect(maskEmail('santiago@correo.com')).toBe('sa••••@correo.com');
    expect(maskEmail('a@b.co')).toMatch(/@b\.co$/);
    expect(maskEmail('sin-arroba')).toBe('');
    expect(maskPhone('3001234542')).toBe('3•• ••• ••42');
    expect(maskPhone('+57 300 123 4542')).toBe('+57 3•• ••• ••42');
    expect(maskPhone('123')).toBe('');
  });

  it('cleans, pastes across boxes and formats the resend countdown', () => {
    expect(cleanOtp('12a3 4567')).toBe('123456');
    expect(pasteInto(['', '', '', '', '', ''], 0, '123456')).toEqual({ digits: ['1', '2', '3', '4', '5', '6'], focus: 5 });
    expect(pasteInto(['', '', '', '', '', ''], 3, '123 456')).toEqual({ digits: ['1', '2', '3', '4', '5', '6'], focus: 5 });
    expect(pasteInto(['9', '', '', '', '', ''], 1, '12')).toEqual({ digits: ['9', '1', '2', '', '', ''], focus: 3 });
    expect(pasteInto(['', '', '', '', '', ''], 0, 'abc').digits.join('')).toBe('');
    expect(formatCountdown(58)).toBe('00:58');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-3)).toBe('00:00');
  });
});

describe('registration validation (same schemas as the mobile app)', () => {
  it('accepts a complete step 1', () => {
    expect(validateStep1(step1(), '57')).toEqual({});
  });

  it('reports field errors as translation keys', () => {
    expect(validateStep1(step1({ name: '', businessName: '' }), '57')).toMatchObject({ name: 'required', businessName: 'required' });
    expect(validateStep1(step1({ password: 'corta', confirm: 'corta' }), '57').password).toBe('password_weak');
    expect(validateStep1(step1({ confirm: 'Otra1234' }), '57').confirm).toBe('passwords_mismatch');
    expect(validateStep1(step1({ accepted: false }), '57').acceptTerms).toBe('terms_required');
    expect(validateStep1(step1({ email: '', phone: '' }), '57').email).toBe('contact_required');
    expect(validateStep1(step1({ email: 'no-es-correo' }), '57').email).toBeTruthy();
  });

  it('validates the phone with the selected country prefix', () => {
    expect(validateStep1(step1({ email: '', phone: '300 123 4567' }), '57')).toEqual({});
    expect(validateStep1(step1({ email: '', phone: '555 123 4567' }), '1')).toEqual({});
    expect(validateStep1(step1({ email: '', phone: '12' }), '57').phone).toBe('phone_invalid');
    expect(buildRegisterPayload(step1({ email: '', phone: '300 123 4567' }), '57').phone).toBe('573001234567');
  });

  it('does not ask for a password when the account comes from Google/Apple', () => {
    const social = step1({ password: '', confirm: '', social: { provider: 'google', name: 'Ana', email: 'ana@gmail.com' } });
    expect(validateStep1(social, '57')).toEqual({});
  });

  it('validates step 2 and turns the country into name + currency for PATCH /api/business', () => {
    const values: Step2Values = { address: 'Calle 1 # 2-3', city: 'Bogotá', country: 'MX', hours: initialHours() };
    expect(validateStep2(values)).toEqual({});
    expect(buildBusinessUpdate(values)).toMatchObject({ address: 'Calle 1 # 2-3', city: 'Bogotá', country: 'México', currency: 'MXN' });
    expect(validateStep2({ ...values, address: 'x'.repeat(161) }).address).toBeTruthy();
    expect(validateStep2({ ...values, hours: applyRowChange(values.hours, rowsOf(values.hours)[0]!, { from: '20:00' }) }).hours).toBe('hours_close_after_open');
  });
});

/* ---------- Envío en secuencia ---------- */

const user = { id: 'u1', name: 'Ana' } as User;
const business = (over: Partial<Business> = {}) => ({ id: 'b1', name: 'Studio Ana', logoUrl: null, country: '', ...over }) as Business;
const session = (): AuthSession => ({ accessToken: 'access-1', refreshToken: 'refresh-1', user, business: business() });

function makeDeps(over: Partial<RegistrationDeps> = {}) {
  const calls: string[] = [];
  const deps: RegistrationDeps = {
    register: vi.fn(async () => (calls.push('register'), session())),
    authorize: vi.fn(() => void calls.push('authorize')),
    updateBusiness: vi.fn(async () => (calls.push('updateBusiness'), business({ country: 'Colombia' }))),
    uploadLogo: vi.fn(async () => (calls.push('uploadLogo'), business({ country: 'Colombia', logoUrl: '/media/logo.jpg' }))),
    signIn: vi.fn(async () => void calls.push('signIn')),
    ...over,
  };
  return { deps, calls };
}
const input = (photo: { uri: string; width: number } | null = { uri: 'blob:x', width: 800 }) => ({
  payload: buildRegisterPayload(step1(), '57'),
  business: buildBusinessUpdate({ address: '', city: '', country: 'CO', hours: initialHours() }),
  photo,
});

describe('runRegistration', () => {
  it('registers, saves the business, uploads the photo and only then signs in — with the freshest business', async () => {
    const { deps, calls } = makeDeps();
    expect(await runRegistration(input(), deps)).toEqual({ status: 'done' });
    expect(calls).toEqual(['register', 'authorize', 'updateBusiness', 'uploadLogo', 'signIn']);
    const signedIn = vi.mocked(deps.signIn).mock.calls[0]![0];
    expect(signedIn.business.logoUrl).toBe('/media/logo.jpg');
    expect(signedIn.accessToken).toBe('access-1');
  });

  it('skips the upload when no photo was chosen', async () => {
    const { deps, calls } = makeDeps();
    await runRegistration(input(null), deps);
    expect(calls).toEqual(['register', 'authorize', 'updateBusiness', 'signIn']);
  });

  it('reports a failed registration (e.g. duplicate email) without touching anything else', async () => {
    const boom = new Error('email_exists');
    const { deps, calls } = makeDeps({ register: vi.fn(async () => Promise.reject(boom)) });
    expect(await runRegistration(input(), deps)).toEqual({ status: 'failed', error: boom });
    expect(calls).toEqual([]);
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  it('never registers twice: a failure after registering returns progress and a retry resumes from there', async () => {
    const { deps } = makeDeps({ updateBusiness: vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(business({ country: 'Colombia' })) });
    const first = await runRegistration(input(), deps);
    expect(first).toMatchObject({ status: 'partial', failed: 'business' });
    if (first.status !== 'partial') throw new Error('unreachable');
    expect(deps.signIn).not.toHaveBeenCalled();

    expect(await runRegistration(input(), deps, first.progress)).toEqual({ status: 'done' });
    expect(deps.register).toHaveBeenCalledTimes(1);
    expect(deps.updateBusiness).toHaveBeenCalledTimes(2);
    expect(deps.uploadLogo).toHaveBeenCalledTimes(1);
  });

  it('a failed photo keeps the saved business and lets the person enter without it', async () => {
    const { deps } = makeDeps({ uploadLogo: vi.fn(async () => Promise.reject(new Error('too_large'))) });
    const result = await runRegistration(input(), deps);
    expect(result).toMatchObject({ status: 'partial', failed: 'logo' });
    if (result.status !== 'partial') throw new Error('unreachable');
    expect(result.progress.businessSaved).toBe(true);
    await enterWithProgress(result.progress, deps);
    expect(vi.mocked(deps.signIn).mock.calls[0]![0].business.country).toBe('Colombia');
  });
});

describe('image upload sizing', () => {
  it('shrinks wide photos to 1600 px keeping the aspect ratio and never enlarges', () => {
    expect(scaledSize(3200, 2400)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(10000, 1)).toEqual({ width: 1600, height: 1 });
  });
});
