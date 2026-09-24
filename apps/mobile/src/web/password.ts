/** Reglas de contraseña (las mismas que `passwordSchema` de @xiro/shared) para la validación en vivo y el medidor de fortaleza. */

export type PasswordRuleId = 'length' | 'upper' | 'digit';

export const PASSWORD_RULES: Array<{ id: PasswordRuleId; test: (value: string) => boolean }> = [
  { id: 'length', test: (v) => v.length >= 8 && v.length <= 128 },
  { id: 'upper', test: (v) => /[A-Z]/.test(v) },
  { id: 'digit', test: (v) => /\d/.test(v) },
];

export const passwordRuleStatus = (value: string) => PASSWORD_RULES.map((rule) => ({ id: rule.id, met: rule.test(value) }));

export type Strength = 0 | 1 | 2 | 3 | 4;

/** 0 = vacía. Cumplir las 3 reglas da "aceptable" (2); la longitud y la variedad la suben. */
export function passwordStrength(value: string): Strength {
  if (!value) return 0;
  const met = PASSWORD_RULES.filter((rule) => rule.test(value)).length;
  if (met < 3) return 1;
  let score = 2;
  if (value.length >= 12) score += 1;
  if (/[^A-Za-z0-9]/.test(value) && /[a-z]/.test(value)) score += 1;
  return Math.min(score, 4) as Strength;
}
