import { describe, expect, it } from 'vitest';
import { accountAccessSummary, accountAccessTextKeys, translate, type Subscription } from '../src';

const NOW = new Date('2026-10-18T15:00:00Z');
const base: Subscription = { plan: null, status: 'none', platform: null, paymentMethod: null, trialEndsAt: null, currentPeriodEnd: null, nextBillingAt: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: null, hasAccess: false };
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe('tarjeta "Suscripción y estado de cuenta": qué estado y qué fecha se muestran', () => {
  it('prueba gratis: fecha = fin de la prueba, con días restantes', () => {
    const s = accountAccessSummary({ ...base, status: 'trial', trialEndsAt: inDays(5), hasAccess: true }, NOW);
    expect(s).toMatchObject({ kind: 'trial', endsAt: inDays(5), daysLeft: 5, renews: false });
    expect(accountAccessTextKeys(s)).toEqual({ title: 'account_access_kind_trial', description: 'account_access_desc_trial', dateLabel: 'account_access_date_trial', days: { key: 'account_access_days_left', n: 5 } });
  });

  it('pago activo: el fin del período NO se presenta como vencimiento si se renueva solo', () => {
    const renews = accountAccessSummary({ ...base, status: 'active', currentPeriodEnd: inDays(20), hasAccess: true }, NOW);
    expect(accountAccessTextKeys(renews).dateLabel).toBe('account_access_date_active_renews');
    const ends = accountAccessSummary({ ...base, status: 'active', currentPeriodEnd: inDays(20), cancelAtPeriodEnd: true, hasAccess: true }, NOW);
    expect(accountAccessTextKeys(ends)).toMatchObject({ dateLabel: 'account_access_date_active_ends', description: 'account_access_desc_active_ends' });
  });

  it('gracia: fecha = fin de la gracia; vencido: sin días restantes', () => {
    expect(accountAccessSummary({ ...base, status: 'past_due', gracePeriodEndsAt: inDays(1), hasAccess: true }, NOW)).toMatchObject({ kind: 'grace', daysLeft: 1 });
    const expired = accountAccessSummary({ ...base, status: 'expired', gracePeriodEndsAt: inDays(-3) }, NOW);
    expect(expired).toMatchObject({ kind: 'expired', hasAccess: false, daysLeft: null });
    expect(accountAccessTextKeys(expired).days).toBeNull();
  });

  it('cortesía vigente sobre un plan vencido: manda la cortesía y su fecha', () => {
    const s = accountAccessSummary({ ...base, status: 'expired', hasAccess: true, accessGrantEndsAt: inDays(30) }, NOW);
    expect(s).toMatchObject({ kind: 'courtesy', endsAt: inDays(30), daysLeft: 30 });
    expect(accountAccessTextKeys(s).dateLabel).toBe('account_access_date_courtesy');
  });

  it('cortesía programada después de la prueba: se informa aparte, sin cambiar el estado actual', () => {
    const s = accountAccessSummary({ ...base, status: 'trial', trialEndsAt: inDays(2), hasAccess: true, accessGrantUpcoming: { startsAt: inDays(2), endsAt: inDays(32) } }, NOW);
    expect(s).toMatchObject({ kind: 'trial', upcomingCourtesy: { startsAt: inDays(2), endsAt: inDays(32) } });
  });

  it('sin plan, cancelado y empleado sin fechas: nunca se inventa una fecha', () => {
    expect(accountAccessSummary(base, NOW)).toMatchObject({ kind: 'no_plan', endsAt: null, daysLeft: null });
    expect(accountAccessSummary({ ...base, status: 'canceled' }, NOW)).toMatchObject({ kind: 'canceled', endsAt: null });
    // A un empleado la API no le envía las fechas del plan: el estado se ve, la fecha queda "no disponible".
    const employee = accountAccessSummary({ ...base, status: 'trial', hasAccess: true }, NOW);
    expect(employee).toMatchObject({ kind: 'trial', endsAt: null, daysLeft: null });
    expect(accountAccessTextKeys(employee).days).toBeNull();
  });

  it('días restantes: último día y un día, en singular', () => {
    expect(accountAccessTextKeys(accountAccessSummary({ ...base, status: 'trial', trialEndsAt: inDays(0.5), hasAccess: true }, NOW)).days).toEqual({ key: 'account_access_day_left' });
    expect(accountAccessTextKeys(accountAccessSummary({ ...base, status: 'trial', trialEndsAt: inDays(-0.01), hasAccess: true }, NOW)).days).toEqual({ key: 'account_access_last_day' });
  });

  it('todas las claves que puede pedir la tarjeta existen en español e inglés', () => {
    const kinds = [
      { ...base, status: 'trial' as const, trialEndsAt: inDays(3), hasAccess: true },
      { ...base, status: 'active' as const, currentPeriodEnd: inDays(3), hasAccess: true },
      { ...base, status: 'active' as const, currentPeriodEnd: inDays(3), cancelAtPeriodEnd: true, hasAccess: true },
      { ...base, status: 'past_due' as const, gracePeriodEndsAt: inDays(3), hasAccess: true },
      { ...base, status: 'expired' as const, hasAccess: true, accessGrantEndsAt: inDays(3) },
      { ...base, status: 'expired' as const },
      { ...base, status: 'canceled' as const },
      { ...base, status: 'past_due' as const },
      base,
    ];
    for (const sub of kinds) {
      const keys = accountAccessTextKeys(accountAccessSummary(sub, NOW));
      for (const key of [keys.title, keys.description, keys.dateLabel, keys.days?.key].filter((k): k is string => Boolean(k))) {
        expect(translate('es', key)).not.toBe(key);
        expect(translate('en', key)).not.toBe(key);
      }
    }
  });
});
