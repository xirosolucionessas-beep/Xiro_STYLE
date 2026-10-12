import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  deriveEffectiveStatus,
  formatMoney,
  identifierSchema,
  itemInputSchema,
  normalizePhone,
  passwordSchema,
  registerSchema,
  subscriptionHasAccess,
  subscriptionNotice,
  suggestStockStatus,
  summarizeStock,
  translate,
  whatsappLink,
} from '../src';

describe('phone', () => {
  it('adds the Colombian country code to 10-digit mobiles', () => {
    expect(normalizePhone('300 123 4567')).toBe('573001234567');
    expect(normalizePhone('+57 (301) 123-4567')).toBe('573011234567');
  });
  it('rejects garbage', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('0123456789012')).toBeNull();
  });
  it('builds a wa.me link with an encoded message', () => {
    expect(whatsappLink('3001234567', 'Hola & adiós')).toBe('https://wa.me/573001234567?text=Hola%20%26%20adi%C3%B3s');
  });
});

describe('stock', () => {
  it('suggests the status from the quantity', () => {
    expect(suggestStockStatus(0)).toBe('out_of_stock');
    expect(suggestStockStatus(3)).toBe('reorder');
    expect(suggestStockStatus(5)).toBe('reorder');
    expect(suggestStockStatus(6)).toBe('available');
  });
  it('summarizes items by status', () => {
    expect(summarizeStock([{ stockStatus: 'available' }, { stockStatus: 'reorder' }, { stockStatus: 'available' }])).toEqual({
      total: 3,
      available: 2,
      reorder: 1,
      out_of_stock: 0,
    });
  });
});

describe('schemas', () => {
  it('enforces the password policy', () => {
    expect(passwordSchema.safeParse('Abcdef12').success).toBe(true);
    expect(passwordSchema.safeParse('abcdef12').success).toBe(false);
    expect(passwordSchema.safeParse('Abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('Ab1').success).toBe(false);
  });
  it('parses identifiers as email or phone', () => {
    expect(identifierSchema.parse(' Ana@Correo.COM ')).toEqual({ kind: 'email', value: 'ana@correo.com' });
    expect(identifierSchema.parse('3001234567')).toEqual({ kind: 'phone', value: '573001234567' });
    expect(identifierSchema.safeParse('nope').success).toBe(false);
  });
  it('requires a contact and accepted terms on register', () => {
    const base = { name: 'Ana', businessName: 'Studio', password: 'Abcdef12', acceptTerms: true as const };
    expect(registerSchema.safeParse(base).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, email: 'ana@correo.com' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, email: 'ana@correo.com', acceptTerms: false }).success).toBe(false);
  });
  it('rejects negative or fractional prices', () => {
    const base = { name: 'Corte', categoryId: 'c1' };
    expect(itemInputSchema.safeParse({ ...base, price: 35000 }).success).toBe(true);
    expect(itemInputSchema.safeParse({ ...base, price: -1 }).success).toBe(false);
    expect(itemInputSchema.safeParse({ ...base, price: 10.5 }).success).toBe(false);
  });
});

describe('subscription', () => {
  const day = 86_400_000;
  const now = new Date('2026-01-15T12:00:00Z');

  it('hasAccess: trial/active dan acceso; vencido solo dentro del período de gracia', () => {
    expect(subscriptionHasAccess('trial', null, now)).toBe(true);
    expect(subscriptionHasAccess('active', null, now)).toBe(true);
    expect(subscriptionHasAccess('past_due', new Date(now.getTime() + day), now)).toBe(true);
    expect(subscriptionHasAccess('past_due', new Date(now.getTime() - day), now)).toBe(false);
    expect(subscriptionHasAccess('past_due', null, now)).toBe(false);
    expect(subscriptionHasAccess('expired', null, now)).toBe(false);
    expect(subscriptionHasAccess('canceled', null, now)).toBe(false);
    expect(subscriptionHasAccess('none', null, now)).toBe(false);
  });

  it('daysUntil cuenta días de calendario (negativo si ya pasó)', () => {
    expect(daysUntil(new Date(now.getTime() + 2 * day), now)).toBe(2);
    expect(daysUntil(new Date(now.getTime() - 2 * day), now)).toBe(-2);
    expect(daysUntil(null, now)).toBeNull();
  });

  it('deriveEffectiveStatus se autocorrige cuando el webhook nunca llegó', () => {
    expect(deriveEffectiveStatus({ status: 'trial', trialEndsAt: new Date(now.getTime() - day), currentPeriodEnd: null, gracePeriodEndsAt: null }, now)).toBe('past_due');
    expect(deriveEffectiveStatus({ status: 'active', trialEndsAt: null, currentPeriodEnd: new Date(now.getTime() - day), gracePeriodEndsAt: null }, now)).toBe('past_due');
    expect(deriveEffectiveStatus({ status: 'past_due', trialEndsAt: null, currentPeriodEnd: null, gracePeriodEndsAt: new Date(now.getTime() - day) }, now)).toBe('expired');
    // Todavía dentro de sus fechas: sin cambios.
    expect(deriveEffectiveStatus({ status: 'trial', trialEndsAt: new Date(now.getTime() + day), currentPeriodEnd: null, gracePeriodEndsAt: null }, now)).toBe('trial');
  });

  it('subscriptionNotice: bloquea solo sin acceso real, avisa en gracia, recuerda cerca del vencimiento', () => {
    const base = { plan: 'monthly' as const, trialEndsAt: null, currentPeriodEnd: null, gracePeriodEndsAt: null, cancelAtPeriodEnd: false };
    expect(subscriptionNotice({ ...base, status: 'expired', hasAccess: false }, now)).toBe('blocked');
    expect(subscriptionNotice({ ...base, status: 'none', hasAccess: false }, now)).toBeNull(); // nunca tuvo plan: no es este aviso
    expect(subscriptionNotice({ ...base, status: 'canceled', hasAccess: false }, now)).toBeNull();
    expect(subscriptionNotice({ ...base, status: 'past_due', hasAccess: true, gracePeriodEndsAt: new Date(now.getTime() + day).toISOString() }, now)).toBe('grace');
    expect(subscriptionNotice({ ...base, status: 'active', hasAccess: true, cancelAtPeriodEnd: true, currentPeriodEnd: new Date(now.getTime() + day).toISOString() }, now)).toBeNull();
    expect(subscriptionNotice({ ...base, status: 'trial', hasAccess: true, trialEndsAt: new Date(now.getTime() + 2 * day).toISOString() }, now)).toBe('expiring_soon');
    expect(subscriptionNotice({ ...base, status: 'active', hasAccess: true, currentPeriodEnd: new Date(now.getTime() + 10 * day).toISOString() }, now)).toBeNull();
  });
});

describe('i18n and money', () => {
  it('translates with params and falls back to the key', () => {
    expect(translate('es', 'hello')).toBe('Hola');
    expect(translate('en', 'hello')).toBe('Hello');
    expect(translate('en', 'share_message_catalog', { business: 'Xiro', url: 'u' })).toContain('Xiro');
    expect(translate('es', 'no_such_key')).toBe('no_such_key');
  });
  it('formats COP without decimals', () => {
    expect(formatMoney(35000, 'COP').replace(/\s/g, ' ')).toMatch(/35\.000/);
  });
});

describe('isAllowedPushEndpoint (Fase 3, SSRF)', () => {
  it('acepta los servicios de Web Push reales (https, puerto estándar)', async () => {
    const { isAllowedPushEndpoint } = await import('../src/schemas');
    for (const url of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://web.push.apple.com/QGuQyavXutnMH',
      'https://wns2-par02p.notify.windows.com/w/?token=AwYAAA',
    ]) expect(isAllowedPushEndpoint(url), url).toBe(true);
  });
  it('rechaza direcciones internas, http, otros puertos y dominios parecidos', async () => {
    const { isAllowedPushEndpoint } = await import('../src/schemas');
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'https://169.254.169.254/latest/meta-data/',
      'http://fcm.googleapis.com/fcm/send/x',
      'https://localhost/push',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilpush.apple.com.example/x',
      'https://notify.windows.com.evil.example/x',
      'no es una url',
    ]) expect(isAllowedPushEndpoint(url), url).toBe(false);
  });
});

describe('isAllowedPushEndpoint: trucos de URL', () => {
  it('rechaza usuario@host, barras invertidas y espacios', async () => {
    const { isAllowedPushEndpoint } = await import('../src/schemas');
    for (const url of ['https://fcm.googleapis.com@169.254.169.254/x', 'https://evil.example\@fcm.googleapis.com/x', 'https://fcm.googleapis.com /x', 'https://fcm.googleapis.com#@evil.example']) {
      expect(isAllowedPushEndpoint(url), url).toBe(false);
    }
  });
});
