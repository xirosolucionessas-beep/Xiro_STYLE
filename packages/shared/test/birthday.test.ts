import { describe, expect, it } from 'vitest';
import {
  birthDateSchema,
  birthdayDiscount,
  birthdayInYear,
  birthdayProgramSchema,
  birthdayWindowOn,
  clientInputSchema,
  DEFAULT_BIRTHDAY_PROGRAM,
  eligibleSubtotal,
  localDateTimeIn,
  rewardState,
  translate,
} from '../src';

describe('cumpleaños: fechas', () => {
  it('29 de febrero se celebra el 28 en años no bisiestos (y el 29 en bisiestos, incluido 2000; no en 2100)', () => {
    expect(birthdayInYear('2000-02-29', 2027)).toBe('2027-02-28');
    expect(birthdayInYear('2000-02-29', 2028)).toBe('2028-02-29');
    expect(birthdayInYear('1996-02-29', 2000)).toBe('2000-02-29');
    expect(birthdayInYear('1996-02-29', 2100)).toBe('2100-02-28');
    expect(birthdayInYear('1990-07-04', 2027)).toBe('2027-07-04');
  });

  it('fecha de nacimiento: real, desde 1900 y no futura (mirando el día más adelantado del planeta)', () => {
    const now = () => new Date('2026-10-19T12:00:00Z');
    const schema = birthDateSchema(now);
    expect(schema.safeParse('2000-02-29').success).toBe(true);
    expect(schema.safeParse('2026-10-20').success).toBe(true); // ya es 20 en UTC+14
    for (const bad of ['2023-02-29', '1990-04-31', '1899-12-31', '2026-10-21', '19/10/1990', '']) expect(schema.safeParse(bad).success).toBe(false);
  });

  it('el formulario de cliente distingue "no tocar" (omitida), "quitar" (null o vacío) y "guardar"', () => {
    expect(clientInputSchema.parse({ name: 'A' }).birthDate).toBeUndefined();
    expect(clientInputSchema.parse({ name: 'A', birthDate: '' }).birthDate).toBeNull();
    expect(clientInputSchema.parse({ name: 'A', birthDate: null }).birthDate).toBeNull();
    expect(clientInputSchema.parse({ name: 'A', birthDate: '1990-01-31' }).birthDate).toBe('1990-01-31');
  });

  it('ventana de vigencia, incluida la que cruza el año nuevo', () => {
    expect(birthdayWindowOn('1995-12-31', '2028-01-03', 7)).toEqual({ year: 2027, birthdayOn: '2027-12-31', endsOn: '2028-01-06' });
    expect(birthdayWindowOn('1995-12-31', '2028-01-07', 7)).toBeNull();
    expect(birthdayWindowOn('1990-05-10', '2027-05-10', 1)).toEqual({ year: 2027, birthdayOn: '2027-05-10', endsOn: '2027-05-10' });
    expect(birthdayWindowOn('1990-05-10', '2027-05-09', 7)).toBeNull();
  });

  it('fecha y hora local del negocio según su zona horaria', () => {
    expect(localDateTimeIn('America/Bogota', new Date('2027-01-01T03:00:00Z'))).toEqual({ date: '2026-12-31', hour: 22 });
    expect(localDateTimeIn('Asia/Tokyo', new Date('2027-03-09T23:30:00Z'))).toEqual({ date: '2027-03-10', hour: 8 });
  });
});

describe('cumpleaños: recompensa', () => {
  it('estados: una disponible pasada su vigencia se ve vencida; usada o canjeada se mantiene', () => {
    expect(rewardState({ status: 'available', endsOn: '2027-05-16' }, '2027-05-16')).toBe('available');
    expect(rewardState({ status: 'available', endsOn: '2027-05-16' }, '2027-05-17')).toBe('expired');
    expect(rewardState({ status: 'redeemed', endsOn: '2027-05-16' }, '2027-06-01')).toBe('redeemed');
  });

  it('alcance y descuento: porcentaje o monto fijo, compra mínima y nunca más que la parte que aplica', () => {
    const lines = [{ kind: 'service' as const, total: 30000 }, { kind: 'product' as const, total: 10000 }, { kind: 'package' as const, total: 5000 }];
    expect(eligibleSubtotal(lines, 'all')).toBe(45000);
    expect(eligibleSubtotal(lines, 'services')).toBe(35000);
    expect(eligibleSubtotal(lines, 'products')).toBe(10000);
    expect(birthdayDiscount(35000, { rewardKind: 'percent', rewardValue: 20, minTotal: 0 })).toBe(7000);
    expect(birthdayDiscount(10000, { rewardKind: 'fixed', rewardValue: 50000, minTotal: 0 })).toBe(10000);
    expect(birthdayDiscount(10000, { rewardKind: 'fixed', rewardValue: 5000, minTotal: 20000 })).toBe(0);
  });

  it('configuración: apagada por defecto y con rangos validados', () => {
    expect(DEFAULT_BIRTHDAY_PROGRAM.enabled).toBe(false);
    expect(birthdayProgramSchema.safeParse(DEFAULT_BIRTHDAY_PROGRAM).success).toBe(true);
    expect(birthdayProgramSchema.safeParse({ ...DEFAULT_BIRTHDAY_PROGRAM, rewardValue: 0 }).success).toBe(false);
    expect(birthdayProgramSchema.safeParse({ ...DEFAULT_BIRTHDAY_PROGRAM, rewardKind: 'fixed', rewardValue: 2_000_000_000 }).success).toBe(false);
    expect(birthdayProgramSchema.safeParse({ ...DEFAULT_BIRTHDAY_PROGRAM, validDays: 61 }).success).toBe(false);
  });

  it('los textos del programa existen en español e inglés', () => {
    for (const key of ['birthday_program_title', 'birthday_rules', 'birth_date', 'push_birthday_body', 'birthday_whatsapp_text', 'birthday_reward_unavailable', 'birthday_state_expired']) {
      expect(translate('es', key)).not.toBe(key);
      expect(translate('en', key)).not.toBe(key);
      expect(translate('en', key)).not.toBe(translate('es', key));
    }
  });
});
