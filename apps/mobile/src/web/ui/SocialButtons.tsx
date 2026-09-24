import type { SocialIntent, SocialProvider } from '../services/socialAuth.web';
import type { SocialUiState } from '../services/useSocialAuth';
import { SocialButton, socialState } from './SocialButton';

/**
 * Los dos botones (Google y Apple) con el texto de cada contexto: "Iniciar sesión con…" en bienvenida y login,
 * "Registrarme con…" en el paso 1 del registro. Mismo diseño, logos y estados en los tres.
 */
export function SocialButtons({ t, intent, state, onSocial }: { t: (key: string) => string; intent: SocialIntent; state: Pick<SocialUiState, 'available' | 'busy' | 'error'>; onSocial: (provider: SocialProvider) => void }) {
  const prefix = intent === 'signin' ? 'sign_in' : 'sign_up';
  return (
    <>
      <div className="xw-social-stack">
        {(['google', 'apple'] as const).map((provider) => (
          <SocialButton
            key={provider}
            provider={provider}
            label={t(`${prefix}_${provider}`)}
            state={socialState(state.available[provider], state.busy === provider)}
            soonLabel={t('soon')}
            loadingLabel={t('social_loading')}
            onPress={() => onSocial(provider)}
          />
        ))}
      </div>
      <p className="xw-wmsg" role="status">
        {state.error}
      </p>
    </>
  );
}
