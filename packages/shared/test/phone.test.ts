import { describe, expect, it } from 'vitest';
import { phoneHref } from '../src/phone';


describe('phoneHref', () => {
  it('agrega el indicativo de Colombia a un celular de 10 dígitos', () => {
    expect(phoneHref('3001234567')).toBe('tel:+573001234567');
    expect(phoneHref('300 123 4567')).toBe('tel:+573001234567');
  });
  it('respeta un número que ya trae indicativo y limpia lo que no son dígitos', () => {
    expect(phoneHref('+57 300 123 4567')).toBe('tel:+573001234567');
    expect(phoneHref('+1 (415) 555-0100')).toBe('tel:+14155550100');
  });
  it('un número que no se puede normalizar conserva solo sus dígitos', () => {
    expect(phoneHref('601 234 567')).toBe('tel:601234567');
  });
});
