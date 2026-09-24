import { describe, expect, it } from 'vitest';
import { localDateKey } from '../src/web/date';
import { digitsOnly, formatAmountInput, groupThousands, parseAmountInput } from '../src/web/money';

describe('localDateKey', () => {
  it('formats the LOCAL date (not UTC) with zero-padding', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 10, 21, 0, 0))).toBe('2026-11-21');
  });
});

describe('money input formatting', () => {
  it('keeps only digits and drops a leading zero', () => {
    expect(digitsOnly('1a2b3')).toBe('123');
    expect(digitsOnly('0100000')).toBe('100000');
    expect(digitsOnly('0')).toBe('0');
    expect(digitsOnly('')).toBe('');
  });

  it('groups thousands with a dot, like the rest of the app', () => {
    expect(groupThousands('1000000')).toBe('1.000.000');
    expect(groupThousands('999')).toBe('999');
    expect(groupThousands('45000')).toBe('45.000');
  });

  it('formats what is typed live and parses back the real number', () => {
    expect(formatAmountInput('100000')).toBe('100.000');
    expect(formatAmountInput('abc100000')).toBe('100.000');
    expect(parseAmountInput('100.000')).toBe(100000);
    expect(parseAmountInput('')).toBe(0);
    expect(parseAmountInput(formatAmountInput('45000'))).toBe(45000);
  });
});
