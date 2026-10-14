import { describe, expect, it } from 'vitest';
import { EXPENSE_AMOUNT_MAX, EXPENSE_AMOUNT_MIN, expenseAmountIssue, expenseInputSchema, expenseUpdateSchema, translate } from '../src';

/** Monto del gasto: pesos enteros de 1 a 1.000.000.000 (decisión del producto), con mensajes claros en ambos idiomas. */
const issueOf = (schema: typeof expenseInputSchema | typeof expenseUpdateSchema, amount: unknown) => {
  const result = schema.safeParse({ amount, description: 'Insumos', method: 'bank_transfer' });
  return result.success ? null : result.error.issues.find((i) => i.path[0] === 'amount')?.message ?? null;
};

describe('monto del gasto', () => {
  it('límites exactos', () => {
    expect([EXPENSE_AMOUNT_MIN, EXPENSE_AMOUNT_MAX]).toEqual([1, 1_000_000_000]);
  });

  it('la API (alta y edición) acepta los límites exactos y rechaza cada caso con su mensaje', () => {
    for (const schema of [expenseInputSchema, expenseUpdateSchema]) {
      expect(issueOf(schema, 1)).toBeNull();
      expect(issueOf(schema, 1_000_000_000)).toBeNull();
      expect(issueOf(schema, 0)).toBe('expense_amount_min');
      expect(issueOf(schema, -5)).toBe('expense_amount_min');
      expect(issueOf(schema, 1.5)).toBe('expense_amount_integer');
      expect(issueOf(schema, 1_000_000_001)).toBe('expense_amount_max');
      expect(issueOf(schema, '5000')).toBe('expense_amount_required');
      expect(issueOf(schema, undefined)).toBe('expense_amount_required');
    }
  });

  it('el formulario aplica la misma regla sobre lo que se escribió', () => {
    expect(expenseAmountIssue('')).toBe('expense_amount_required');
    expect(expenseAmountIssue('0')).toBe('expense_amount_min');
    expect(expenseAmountIssue('1')).toBeNull();
    expect(expenseAmountIssue('1000000000')).toBeNull();
    expect(expenseAmountIssue('1000000001')).toBe('expense_amount_max');
    expect(expenseAmountIssue('9999999999')).toBe('expense_amount_max');
    expect(expenseAmountIssue('12,50')).toBe('expense_amount_integer');
    expect(expenseAmountIssue('-5')).toBe('expense_amount_required');
  });

  it('cada mensaje y la ayuda del rango existen en español e inglés', () => {
    for (const key of ['expense_amount_required', 'expense_amount_integer', 'expense_amount_min', 'expense_amount_max', 'exp_amount_hint']) {
      for (const lang of ['es', 'en'] as const) expect(translate(lang, key), `${lang}:${key}`).not.toBe(key);
    }
  });
});
