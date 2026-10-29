import type { AuthSession, Business, User } from '@xiro/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, configureSession, setAccessToken, usesCookieSession } from './api';
import { push } from './push';
import { useSettings } from './settings';
import { remembersSession, secureStorage } from './storage';

const REFRESH_KEY = 'xiro.refresh';

type Status = 'loading' | 'signedOut' | 'signedIn' | 'error';

interface SessionValue {
  status: Status;
  user: User | null;
  business: Business | null;
  signIn: (session: AuthSession) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
  setBusiness: (business: Business) => void;
  retryBoot: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { setLanguage, setTheme, ready } = useSettings();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const refreshToken = useRef<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  const apply = useCallback(
    async (session: AuthSession) => {
      // Web: la API entrega el refresh token en una cookie HttpOnly y aquí llega vacío (nada que guardar en JavaScript);
      // se borra cualquier copia vieja de localStorage. Nativo: Keychain/Keystore, como siempre.
      refreshToken.current = session.refreshToken || null;
      setAccessToken(session.accessToken);
      if (session.refreshToken) await secureStorage.set(REFRESH_KEY, session.refreshToken);
      else await secureStorage.remove(REFRESH_KEY);
      setUser(session.user);
      setBusiness(session.business);
      setLanguage(session.user.language);
      setTheme(session.user.theme);
      setStatus('signedIn');
    },
    [setLanguage, setTheme],
  );

  const clear = useCallback(async () => {
    refreshToken.current = null;
    setAccessToken(null);
    await secureStorage.remove(REFRESH_KEY);
    queryClient.clear();
    setUser(null);
    setBusiness(null);
    setStatus('signedOut');
  }, [queryClient]);

  useEffect(() => {
    configureSession({
      getRefreshToken: () => refreshToken.current,
      remembers: remembersSession,
      onTokens: (session) => void apply(session),
      onSignedOut: () => void clear(),
    });
    return () => configureSession(null);
  }, [apply, clear]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    (async () => {
      // Web: se intenta con la cookie aunque no haya nada guardado; un token viejo de localStorage (sesiones de antes de la
      // cookie) se canjea UNA vez por la cookie y `apply` lo borra.
      const stored = await secureStorage.get(REFRESH_KEY);
      if (!stored && !usesCookieSession) {
        if (active) setStatus('signedOut');
        return;
      }
      try {
        const session = await api.refresh(stored);
        if (active) await apply(session);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && !error.isNetwork) await clear();
        else setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [ready, bootAttempt, apply, clear]);

  const signOut = useCallback(async () => {
    const token = refreshToken.current;
    // Un dispositivo con la sesión cerrada no debe seguir recibiendo avisos del negocio (aún hay access token para autorizar el borrado).
    await push.disable().catch(() => undefined);
    if (token || usesCookieSession) await api.logout(token).catch(() => undefined);
    await clear();
  }, [clear]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      business,
      signIn: apply,
      signOut,
      setUser,
      setBusiness,
      retryBoot: () => {
        setStatus('loading');
        setBootAttempt((n) => n + 1);
      },
    }),
    [status, user, business, apply, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession debe usarse dentro de SessionProvider');
  return value;
}

/** Usuario y negocio garantizados (solo dentro del grupo autenticado). */
export function useAuthed(): { user: User; business: Business } {
  const { user, business } = useSession();
  if (!user || !business) throw new Error('useAuthed requiere una sesión activa');
  return { user, business };
}
