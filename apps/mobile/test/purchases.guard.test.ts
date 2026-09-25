import { describe, expect, it } from 'vitest';
import { PurchasesUnavailableError, purchasesUsable } from '../src/lib/purchasesGuard';

describe('purchasesUsable (RevenueCat no debe cargarse en Expo Go)', () => {
  it('en Expo Go nunca se usa, aunque haya clave: importar el SDK ahí rompe el arranque', () => {
    expect(purchasesUsable({ inExpoGo: true, apiKey: 'appl_x', loadFailed: false })).toBe(false);
  });
  it('fuera de Expo Go se usa solo si hay clave y el SDK no falló al cargar', () => {
    expect(purchasesUsable({ inExpoGo: false, apiKey: 'appl_x', loadFailed: false })).toBe(true);
    expect(purchasesUsable({ inExpoGo: false, apiKey: undefined, loadFailed: false })).toBe(false);
    expect(purchasesUsable({ inExpoGo: false, apiKey: '', loadFailed: false })).toBe(false);
    expect(purchasesUsable({ inExpoGo: false, apiKey: 'appl_x', loadFailed: true })).toBe(false);
  });
  it('el error de "no disponible" es identificable', () => {
    const error = new PurchasesUnavailableError();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('purchases_unavailable');
  });
});
