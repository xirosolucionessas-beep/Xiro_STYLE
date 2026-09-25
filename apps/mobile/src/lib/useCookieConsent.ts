import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { acceptConsent, needsConsent } from './cookieConsent';
import { useSession } from './session';
import { prefsStorage } from './storage';

/**
 * Estado del aviso de cookies compartido por TODA la app (un solo almacén en memoria): el aviso y el resto de pantallas
 * que necesitan esperar a que se acepte (p. ej. la petición de abrir la caja del día) ven siempre el mismo valor, y
 * aceptar en un sitio lo apaga en todos.
 */
interface ConsentState {
  /** Cuenta cuyo estado ya se consultó al almacenamiento. */
  loadedFor: string | null;
  /** Cuenta que debe ver el aviso ahora mismo. */
  pendingFor: string | null;
}

let state: ConsentState = { loadedFor: null, pendingFor: null };
const listeners = new Set<() => void>();
const set = (next: ConsentState) => {
  state = next;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Consulta una sola vez por cuenta. */
async function load(userId: string): Promise<void> {
  if (state.loadedFor === userId) return;
  set({ loadedFor: userId, pendingFor: state.pendingFor });
  const needed = await needsConsent(prefsStorage, userId);
  set({ loadedFor: userId, pendingFor: needed ? userId : null });
}

/** `visible`: esta sesión es de una cuenta recién creada que aún no aceptó. Aceptar lo oculta al instante y lo guarda para siempre. */
export function useCookieConsent(): { visible: boolean; accept: () => void } {
  const { status, user } = useSession();
  const userId = status === 'signedIn' ? user?.id : undefined;
  const current = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (userId) void load(userId);
  }, [userId]);

  const accept = useCallback(() => {
    if (!userId) return;
    set({ loadedFor: userId, pendingFor: null });
    void acceptConsent(prefsStorage, userId);
  }, [userId]);

  return { visible: Boolean(userId) && current.pendingFor === userId, accept };
}
