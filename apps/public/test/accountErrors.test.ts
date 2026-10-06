import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import { accountErrorMessage } from '../src/lib/accountErrors';

const t = (key: string) => `[${key}]`;

describe('accountErrorMessage: nunca el genérico cuando el servidor ya dijo qué falló', () => {
  it('validation_error con issues traduce la clave del PRIMER campo que falló (p. ej. un celular inválido)', () => {
    const error = new ApiError(400, 'validation_error', [{ path: 'phone', message: 'phone_invalid' }], {});
    expect(accountErrorMessage(t, error)).toBe('[phone_invalid]');
  });

  it('validation_error sin issues (nunca debería pasar, pero no revienta) cae al genérico', () => {
    const error = new ApiError(400, 'validation_error', [], {});
    expect(accountErrorMessage(t, error)).toBe('[unknown_error]');
  });

  it('códigos conocidos de auth usan su propio mensaje, no el de validación', () => {
    expect(accountErrorMessage(t, new ApiError(401, 'invalid_credentials', [], {}))).toBe('[pub_account_err_invalid_credentials]');
    expect(accountErrorMessage(t, new ApiError(409, 'account_exists', [], {}))).toBe('[pub_account_err_account_exists]');
    expect(accountErrorMessage(t, new ApiError(400, 'otp_invalid', [], {}))).toBe('[pub_account_err_otp_invalid]');
    expect(accountErrorMessage(t, new ApiError(400, 'reset_token_invalid', [], {}))).toBe('[pub_account_err_reset_token_invalid]');
    expect(accountErrorMessage(t, new ApiError(429, 'too_many_requests', [], {}))).toBe('[too_many_requests]');
    expect(accountErrorMessage(t, new ApiError(400, 'photo_invalid', [], {}))).toBe('[photo_invalid]');
  });

  it('un error de red usa el mensaje de "sin conexión", no el genérico', () => {
    const networkError = new ApiError(0, 'network_error', [], {});
    expect(accountErrorMessage(t, networkError)).toBe('[offline_error]');
  });

  it('un código desconocido o un error que no es de la API cae al genérico', () => {
    expect(accountErrorMessage(t, new ApiError(500, 'internal_error', [], {}))).toBe('[unknown_error]');
    expect(accountErrorMessage(t, new Error('boom'))).toBe('[unknown_error]');
  });
});
