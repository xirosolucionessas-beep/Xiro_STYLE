import { useCallback, useState } from 'react';
import { providerAvailability, SOCIAL_ERROR_KEYS, startSignIn, type SocialIntent, type SocialProfile, type SocialProvider } from './socialAuth.web';

export interface SocialUiState {
  available: Record<SocialProvider, boolean>;
  busy: SocialProvider | null;
  /** Mensaje amable ya traducido (nunca un error técnico). */
  error: string | null;
  /** "No encontramos una cuenta…": el proveedor no tiene cuenta en Xiro Style; trae lo que se puede precargar. */
  notFound: { provider: SocialProvider; profile: SocialProfile } | null;
}

/**
 * Estado compartido de los botones de Google/Apple de bienvenida, login y registro (un solo flujo, sin lógica duplicada).
 * `onProfile` recibe el perfil cuando el proveedor autentica con éxito (el contenedor decide: iniciar sesión o precargar el registro).
 */
export function useSocialAuth(t: (key: string) => string, intent: SocialIntent, onProfile?: (provider: SocialProvider, profile: SocialProfile) => void) {
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<SocialUiState['notFound']>(null);

  const start = useCallback(
    async (provider: SocialProvider) => {
      setError(null);
      setNotFound(null);
      setBusy(provider);
      try {
        const result = await startSignIn(provider, intent);
        if (result.ok) onProfile?.(provider, result.profile);
        else if (result.error === 'account_not_found' && result.profile) setNotFound({ provider, profile: result.profile });
        else setError(t(SOCIAL_ERROR_KEYS[result.error]));
      } finally {
        setBusy(null);
      }
    },
    [intent, onProfile, t],
  );

  const state: SocialUiState = {
    available: { google: providerAvailability('google').available, apple: providerAvailability('apple').available },
    busy,
    error,
    notFound,
  };
  return { state, start, dismissNotFound: () => setNotFound(null) };
}
