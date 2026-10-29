import { translate, type BirthdayRewardDto, type BirthdayStatusDto } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { birthdaySalePreview } from '../src/lib/birthdaySale';
import { birthdayStatusText, birthdayWhatsappUrl, describeReward } from '../src/lib/birthdayText';

/** Programa de cumpleaños en la app del negocio: textos, mensaje de WhatsApp preparado y vista previa del descuento en caja. */
const t = (key: string, params?: Record<string, string | number>) => translate('es', key, params);

const reward = (patch: Partial<BirthdayRewardDto> = {}): BirthdayRewardDto => ({
  id: 'r1',
  year: 2026,
  startsOn: '2026-10-19',
  endsOn: '2026-10-25',
  state: 'available',
  rewardKind: 'percent',
  rewardValue: 20,
  scope: 'all',
  minTotal: 0,
  combinable: false,
  amount: null,
  usedAt: null,
  ...patch,
});
const status = (patch: Partial<BirthdayStatusDto> = {}): BirthdayStatusDto => ({ programEnabled: true, hasBirthDate: true, message: '', reward: reward(), ...patch });

describe('textos del programa de cumpleaños', () => {
  it('describe la recompensa con alcance y mínimo', () => {
    const text = describeReward(t, reward({ scope: 'services', minTotal: 50000 }), 'COP');
    expect(text).toContain('20');
    expect(text).toContain(t('birthday_reward_scope_services'));
    expect(text).toContain('50.000');
  });

  it('muestra cada estado sin revelar la fecha de nacimiento', () => {
    expect(birthdayStatusText(t, status({ programEnabled: false }), 'COP')).toBe(t('birthday_status_off'));
    expect(birthdayStatusText(t, status({ hasBirthDate: false, reward: null }), 'COP')).toBe(t('birthday_status_no_date'));
    expect(birthdayStatusText(t, status({ reward: null }), 'COP')).toBe(t('birthday_status_none'));
    expect(birthdayStatusText(t, status(), 'COP')).toContain('25/10/2026');
    expect(birthdayStatusText(t, status({ reward: reward({ state: 'expired' }) }), 'COP')).toContain('25/10/2026');
    expect(birthdayStatusText(t, status({ reward: reward({ state: 'redeemed' }) }), 'COP')).toBe(t('birthday_state_redeemed'));
    expect(birthdayStatusText(t, status({ reward: reward({ state: 'claimed' }) }), 'COP')).toBe(t('birthday_state_claimed'));
  });

  it('WhatsApp solo prepara un enlace wa.me con el mensaje (sin envío ni proveedor) y sin la fecha de nacimiento', () => {
    const url = birthdayWhatsappUrl(t, { phone: '3001234567', clientName: 'Ana Pérez', businessName: 'Salón Sol', reward: reward(), message: 'Te esperamos', currency: 'COP' });
    expect(url.startsWith('https://wa.me/')).toBe(true);
    const text = decodeURIComponent(url.split('?text=')[1]!);
    expect(text).toContain('Ana');
    expect(text).not.toContain('Pérez');
    expect(text).toContain('Salón Sol');
    expect(text).toContain('Te esperamos');
    expect(text).toContain('25/10/2026');
    expect(text).not.toMatch(/19\d\d-\d\d-\d\d/);
  });
});

describe('vista previa del regalo en la caja', () => {
  const lines = [
    { kind: 'service' as const, unitPrice: 40000, quantity: 1 },
    { kind: 'product' as const, unitPrice: 10000, quantity: 2 },
  ];

  it('sin programa, sin recompensa o ya usada no ofrece nada', () => {
    expect(birthdaySalePreview(undefined, lines, 0).kind).toBe('none');
    expect(birthdaySalePreview(status({ programEnabled: false }), lines, 0).kind).toBe('none');
    expect(birthdaySalePreview(status({ reward: reward({ state: 'redeemed' }) }), lines, 0).kind).toBe('none');
  });

  it('calcula el porcentaje solo sobre el alcance configurado', () => {
    expect(birthdaySalePreview(status(), lines, 0)).toMatchObject({ kind: 'ready', amount: 12000 });
    expect(birthdaySalePreview(status({ reward: reward({ scope: 'services' }) }), lines, 0)).toMatchObject({ kind: 'ready', amount: 8000 });
    expect(birthdaySalePreview(status({ reward: reward({ scope: 'products' }) }), lines, 0)).toMatchObject({ kind: 'ready', amount: 4000 });
  });

  it('bloquea si no es combinable con un descuento manual o no llega al mínimo', () => {
    expect(birthdaySalePreview(status(), lines, 1000)).toMatchObject({ kind: 'blocked', reason: 'birthday_not_combinable' });
    expect(birthdaySalePreview(status({ reward: reward({ minTotal: 100000 }) }), lines, 0)).toMatchObject({ kind: 'blocked', reason: 'birthday_min_total' });
  });

  it('combinado con otro descuento nunca deja el total en negativo', () => {
    const fixed = status({ reward: reward({ rewardKind: 'fixed', rewardValue: 30000, combinable: true }) });
    expect(birthdaySalePreview(fixed, lines, 50000)).toMatchObject({ kind: 'ready', amount: 10000 });
    expect(birthdaySalePreview(fixed, lines, 60000)).toMatchObject({ kind: 'blocked', reason: 'birthday_nothing_left' });
  });
});
