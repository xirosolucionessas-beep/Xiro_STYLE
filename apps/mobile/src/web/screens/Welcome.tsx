import type { ReactNode } from 'react';
import { Ico, type IconName } from '../icons';
import type { SocialProvider } from '../services/socialAuth.web';
import { Button } from '../ui';
import { SupportLinks } from '../ui/auth';
import { SocialButtons } from '../ui/SocialButtons';
import { useWebStyles } from '../ui/shared';

export type Lang = 'es' | 'en';

export interface WelcomeViewProps {
  language: Lang;
  theme: 'dark' | 'light';
  t: (key: string) => string;
  /** Logo redondeado de la marca (aporta el contenedor; es decorativo junto al nombre). */
  logo: (size: number) => ReactNode;
  /** Chips ES/EN ya renderizados por el contenedor (comparten estilo con el resto de la app). */
  languagePicker: ReactNode;
  onToggleTheme: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onTerms: () => void;
  /** Disponibilidad de cada proveedor y cuál tiene un flujo en curso. */
  social: { available: Record<SocialProvider, boolean>; busy: SocialProvider | null; error: string | null };
  onSocial: (provider: SocialProvider) => void;
}

const VALUES: Array<{ icon: IconName; key: string }> = [
  { icon: 'calendar-days', key: 'value_agenda' },
  { icon: 'users', key: 'value_clients' },
  { icon: 'package', key: 'value_inventory' },
  { icon: 'wallet', key: 'value_cash' },
];

/**
 * Pantalla de bienvenida WEB (solo navegador). Componente puro: recibe todo por props.
 * Escritorio ≥ 1024: dos mitades (marca / acceso) · tablet: columna con panel compacto · móvil: columna limpia.
 */
export function WelcomeView({ language, theme, t, logo, languagePicker, onToggleTheme, onLogin, onRegister, onTerms, social, onSocial }: WelcomeViewProps) {
  useWebStyles();

  return (
    <div className="xw-welcome">
      <div className="xw-bp xw-scope-dark">
        <div className="xw-bp-brand">
          <span className="xw-bp-logo" aria-hidden="true">
            {logo(56)}
          </span>
          <span className="xw-bp-name">{t('app_name')}</span>
        </div>
        <p className="xw-bp-title">
          {t('brand_headline_lead')} <span className="xw-bp-accent">{t('brand_headline_accent')}</span>
        </p>
        <p className="xw-bp-sub">{t('brand_subtitle')}</p>
        <ul className="xw-bp-values" aria-label={t('brand_values_label')}>
          {VALUES.map((value) => (
            <li key={value.key} className="xw-bp-value">
              <span className="xw-bp-value-ic">
                <Ico name={value.icon} size={20} />
              </span>
              {t(value.key)}
            </li>
          ))}
        </ul>
      </div>

      <div className="xw-wpane">
        <div className="xw-wtools">
          <div role="radiogroup" aria-label={t('language')}>
            {languagePicker}
          </div>
          <button type="button" className="xw-round-btn" aria-label={theme === 'dark' ? t('switch_to_light') : t('switch_to_dark')} onClick={onToggleTheme}>
            <Ico name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
          </button>
        </div>

        <section className="xw-wcard" aria-labelledby="xw-welcome-title">
          <h1 id="xw-welcome-title" className="xw-wtitle">
            {t('welcome_title')}
          </h1>
          <p className="xw-wtag">{t('tagline')}</p>

          <div className="xw-wactions">
            <Button fullWidth icon={<Ico name="arrow-right" size={18} />} iconPosition="end" onPress={onLogin}>
              {t('login')}
            </Button>
            <Button fullWidth variant="secondary" onPress={onRegister}>
              {t('create_account')}
            </Button>
          </div>

          <div className="xw-divider">{t('or_sign_in_with')}</div>

          <SocialButtons t={t} intent="signin" state={social} onSocial={onSocial} />

          <a
            className="xw-wterms"
            href="/terms"
            onClick={(event) => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onTerms();
            }}>
            {t('terms_link')}
          </a>

          <SupportLinks t={t} language={language} />
        </section>
      </div>
    </div>
  );
}
