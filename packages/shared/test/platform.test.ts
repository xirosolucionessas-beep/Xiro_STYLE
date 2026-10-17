import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone, normalizePlatformPermissions, platformGrantSchema, subscriptionNotice } from '../src';

describe('panel de plataforma: reglas compartidas', () => {
  it('una concesión de cortesía sobre un plan vencido no muestra aviso de bloqueo ni de gracia', () => {
    const base = { trialEndsAt: null, currentPeriodEnd: '2026-01-01T00:00:00Z', gracePeriodEndsAt: '2026-01-08T00:00:00Z', cancelAtPeriodEnd: false };
    expect(subscriptionNotice({ ...base, status: 'expired', hasAccess: false })).toBe('blocked');
    expect(subscriptionNotice({ ...base, status: 'expired', hasAccess: true, accessGrantEndsAt: '2099-01-01T00:00:00Z' })).toBeNull();
    expect(subscriptionNotice({ ...base, status: 'past_due', hasAccess: true, accessGrantEndsAt: '2099-01-01T00:00:00Z' })).toBeNull();
    // Sin concesión el comportamiento anterior no cambia.
    expect(subscriptionNotice({ ...base, status: 'past_due', hasAccess: true })).toBe('grace');
  });

  it('enmascara correo y teléfono; normaliza permisos desconocidos', () => {
    expect(maskEmail('juana@correo.com')).toBe('j***@correo.com');
    expect(maskEmail(null)).toBeNull();
    expect(maskPhone('+573001234567')).toBe('***4567');
    expect(normalizePlatformPermissions(['metrics_view', 'superadmin', 3])).toEqual(['metrics_view']);
    expect(normalizePlatformPermissions('metrics_view')).toEqual([]);
  });

  it('la concesión valida rango por unidad, motivo mínimo y rechaza campos extra', () => {
    const ok = { unit: 'days', amount: 7, reason: 'Compensación por falla', idempotencyKey: '7f0c9d5e-8f43-4b8a-9e43-5b7d1f2a3c4d', confirmSlug: 'mi-negocio' };
    expect(platformGrantSchema.safeParse(ok).success).toBe(true);
    expect(platformGrantSchema.safeParse({ ...ok, amount: 367 }).success).toBe(false);
    expect(platformGrantSchema.safeParse({ ...ok, unit: 'months', amount: 25 }).success).toBe(false);
    expect(platformGrantSchema.safeParse({ ...ok, reason: 'corta' }).success).toBe(false);
    expect(platformGrantSchema.safeParse({ ...ok, password: 'x' }).success).toBe(false);
  });
});
