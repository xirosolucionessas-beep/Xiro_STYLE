import type { ClientAccountDto } from '@xiro/shared';
import { useCallback, useState } from 'react';
import { publicApi } from '../api';
import { useAsync } from './useAsync';

export interface ClientSessionState {
  /** `undefined` mientras se resuelve la sesión al cargar; `null` = invitado (sin cuenta, o sin sesión). */
  account: ClientAccountDto | null | undefined;
  setAccount: (account: ClientAccountDto | null) => void;
  /** Descarta la actualización optimista y vuelve a pedir la sesión al servidor. */
  refresh: () => void;
  logout: () => Promise<void>;
}

/** Sesión de la cuenta de cliente de ESTE negocio: se restaura sola al cargar (cookie `httpOnly`, ver clientSession.ts
 * del servidor) — nunca hay que volver a pedir celular ni contraseña en este dispositivo mientras siga vigente.
 * Se apoya en `useAsync` (mismo patrón de carga que el resto de la página pública) para el valor traído del servidor,
 * con una actualización optimista encima para que iniciar sesión, registrarse o salir se vean al instante. */
export function useClientSession(slug: string): ClientSessionState {
  const fetchMe = useCallback(async (): Promise<ClientAccountDto | null> => (slug ? ((await publicApi.accountMe(slug)) ?? null) : null), [slug]);
  const fetched = useAsync(fetchMe, [slug]);
  // Válida solo para ESTE slug: si el negocio cambia, la comparación deja de aplicarse sola (sin efecto para reiniciarla).
  const [override, setOverride] = useState<{ forSlug: string; value: ClientAccountDto | null } | null>(null);

  const account = override?.forSlug === slug ? override.value : fetched.loading ? undefined : (fetched.data ?? null);
  const setAccount = useCallback((value: ClientAccountDto | null) => setOverride({ forSlug: slug, value }), [slug]);

  const refresh = useCallback(() => {
    setOverride(null);
    fetched.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const logout = useCallback(async () => {
    try {
      await publicApi.accountLogout(slug);
    } catch {
      /* se cierra igual del lado del cliente; la cookie expira sola si el servidor no respondió */
    }
    setOverride({ forSlug: slug, value: null });
  }, [slug]);

  return { account, setAccount, refresh, logout };
}
