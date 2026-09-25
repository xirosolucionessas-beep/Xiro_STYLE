/**
 * ¿Se puede usar el SDK de RevenueCat en este entorno? Puro (sin importar el SDK) para poder probarlo.
 * RevenueCat necesita su módulo nativo: en Expo Go no existe, y con solo IMPORTAR el SDK ahí la app falla al arrancar
 * ("undefined cannot be used as a constructor"). Además hace falta la clave pública de la tienda de la plataforma.
 */
export function purchasesUsable(input: { inExpoGo: boolean; apiKey: string | undefined; loadFailed: boolean }): boolean {
  return !input.inExpoGo && Boolean(input.apiKey) && !input.loadFailed;
}

/** Error que se lanza al intentar comprar o restaurar cuando el SDK no está disponible (la pantalla ya lo trata como "no se pudo"). */
export class PurchasesUnavailableError extends Error {
  constructor() {
    super('purchases_unavailable');
  }
}
