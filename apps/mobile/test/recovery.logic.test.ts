import { describe, expect, it } from 'vitest';
import { filterPhoneInput, identifierErrorKeyForChannel, isValidColombianPhone, isValidIdentifierForChannel } from '../src/lib/recovery';

describe('filterPhoneInput', () => {
  it('descarta letras y símbolos, conservando solo dígitos', () => {
    expect(filterPhoneInput('abc300-123 4567xyz')).toBe('3001234567');
  });
  it('conserva un "+" inicial para el prefijo internacional', () => {
    expect(filterPhoneInput('+57 300 123 4567')).toBe('+573001234567');
  });
  it('un "+" que no está al principio no se conserva', () => {
    expect(filterPhoneInput('300+1234567')).toBe('3001234567');
  });
});

describe('isValidColombianPhone', () => {
  it('acepta 10 dígitos que empiezan en 3', () => {
    expect(isValidColombianPhone('3001234567')).toBe(true);
  });
  it('acepta el prefijo +57 explícito', () => {
    expect(isValidColombianPhone('+573001234567')).toBe(true);
    expect(isValidColombianPhone('573001234567')).toBe(true);
  });
  it('rechaza números que no empiezan en 3, o con una cantidad de dígitos distinta', () => {
    expect(isValidColombianPhone('2001234567')).toBe(false);
    expect(isValidColombianPhone('300123456')).toBe(false); // 9 dígitos
    expect(isValidColombianPhone('30012345678')).toBe(false); // 11 dígitos, sin +57
  });
});

describe('isValidIdentifierForChannel', () => {
  it('en whatsapp/sms exige un celular colombiano válido', () => {
    expect(isValidIdentifierForChannel('3001234567', 'whatsapp')).toBe(true);
    expect(isValidIdentifierForChannel('correo@ejemplo.com', 'whatsapp')).toBe(false);
    expect(isValidIdentifierForChannel('3001234567', 'sms')).toBe(true);
  });
  it('en correo exige sintaxis de correo válida', () => {
    expect(isValidIdentifierForChannel('correo@ejemplo.com', 'email')).toBe(true);
    expect(isValidIdentifierForChannel('correo-sin-arroba.com', 'email')).toBe(false);
    expect(isValidIdentifierForChannel('3001234567', 'email')).toBe(false);
  });
});

describe('identifierErrorKeyForChannel', () => {
  it('devuelve la clave de error específica del canal', () => {
    expect(identifierErrorKeyForChannel('email')).toBe('email_invalid');
    expect(identifierErrorKeyForChannel('whatsapp')).toBe('phone_invalid');
    expect(identifierErrorKeyForChannel('sms')).toBe('phone_invalid');
  });
});
