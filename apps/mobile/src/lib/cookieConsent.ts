/**
 * Consentimiento de cookies del PRIMER ingreso (onboarding de cuentas nuevas), igual en Web, Android y iOS.
 *
 * Reglas:
 *  - Solo se pide a quien acaba de crear su cuenta en este dispositivo: el registro deja una marca de "pendiente".
 *    Quien ya tenía cuenta (o inicia sesión después) nunca ve el aviso.
 *  - Al aceptar se guarda el consentimiento de ESA cuenta y se quita la marca: no vuelve a mostrarse jamás.
 *  - Se guarda en el almacenamiento del dispositivo (localStorage en Web, AsyncStorage en móvil) sin llamar a la API:
 *    el backend no tiene un campo para esto y no se cambia. Si el almacenamiento falla, el aviso simplemente no aparece
 *    (nunca bloquea el uso de la app).
 */
export interface ConsentStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const PENDING_KEY = 'xiro.cookies.pending';
export const acceptedKey = (userId: string): string => `xiro.cookies.accepted.${userId}`;

/** Marca que esta cuenta acaba de crearse y debe ver el aviso en su primer ingreso. */
export async function markNewAccount(store: ConsentStore, userId: string): Promise<void> {
  try {
    await store.set(PENDING_KEY, userId);
  } catch {
    /* sin almacenamiento no se puede recordar: el aviso no se mostrará, y la cuenta se crea igual */
  }
}

/** ¿Debe mostrarse el aviso a esta cuenta? Solo si es una cuenta recién creada aquí y aún no aceptó. */
export async function needsConsent(store: ConsentStore, userId: string): Promise<boolean> {
  try {
    if ((await store.get(PENDING_KEY)) !== userId) return false;
    return (await store.get(acceptedKey(userId))) === null;
  } catch {
    return false;
  }
}

/** Guarda el consentimiento (con la fecha) y quita la marca de pendiente. */
export async function acceptConsent(store: ConsentStore, userId: string, now: Date = new Date()): Promise<void> {
  try {
    await store.set(acceptedKey(userId), JSON.stringify({ acceptedAt: now.toISOString() }));
    await store.remove(PENDING_KEY);
  } catch {
    /* si no se pudo guardar, el aviso se cerró igual en esta sesión */
  }
}
