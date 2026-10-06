import { translate, type ClientAccountDto, type Language } from '@xiro/shared';
import type { AccountView } from '../lib/route';
import type { ThemeChoice } from '../lib/theme';
import { Icon } from './Icon';

const THEME_CHOICES: Array<{ value: ThemeChoice; icon: 'monitor' | 'sun' | 'moon'; labelKey: 'pub_topbar_theme_system' | 'pub_topbar_theme_light' | 'pub_topbar_theme_dark' }> = [
  { value: 'system', icon: 'monitor', labelKey: 'pub_topbar_theme_system' },
  { value: 'light', icon: 'sun', labelKey: 'pub_topbar_theme_light' },
  { value: 'dark', icon: 'moon', labelKey: 'pub_topbar_theme_dark' },
];

/** Barra superior de la página pública: tema, idioma y, a la derecha, "Ingresar" (invitado) o el avatar de la cuenta —
 * visible en todas las pantallas (perfil del negocio, gestión de cita y las de cuenta). */
export function TopBar({
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  account,
  onAccountNav,
}: {
  language: Language;
  onLanguageChange: (next: Language) => void;
  theme: ThemeChoice;
  onThemeChange: (next: ThemeChoice) => void;
  /** `undefined` = aún sin resolver (no se dibuja nada todavía, para no parpadear); `null` = invitado. */
  account?: ClientAccountDto | null;
  /** Navega a una de las rutas de cuenta ('ingresar' o 'cuenta'). */
  onAccountNav?: (view: AccountView) => void;
}) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  return (
    <div className="xp-topbar">
      <div className="xp-topbar-inner">
        <div className="xp-seg" role="radiogroup" aria-label={t('pub_topbar_theme')}>
          {THEME_CHOICES.map(({ value, icon, labelKey }) => (
            <button key={value} type="button" role="radio" aria-checked={theme === value} aria-label={t(labelKey)} title={t(labelKey)} className="xp-seg-btn" onClick={() => onThemeChange(value)}>
              <Icon name={icon} size={16} />
            </button>
          ))}
        </div>
        <div className="xp-seg" role="radiogroup" aria-label={t('pub_topbar_lang')}>
          <button type="button" role="radio" aria-checked={language === 'es'} aria-label={t('pub_topbar_lang_es')} title={t('pub_topbar_lang_es')} className="xp-seg-btn xp-seg-btn--text" onClick={() => onLanguageChange('es')}>
            ES
          </button>
          <button type="button" role="radio" aria-checked={language === 'en'} aria-label={t('pub_topbar_lang_en')} title={t('pub_topbar_lang_en')} className="xp-seg-btn xp-seg-btn--text" onClick={() => onLanguageChange('en')}>
            EN
          </button>
        </div>
        {onAccountNav && account !== undefined ? (
          account ? (
            <button type="button" className="xp-topbar-account" aria-label={t('pub_account_nav_hi', { name: account.name })} title={t('pub_account_nav_hi', { name: account.name })} onClick={() => onAccountNav('cuenta')}>
              {account.photoUrl ? <img className="xp-topbar-avatar" src={account.photoUrl} alt="" /> : <span className="xp-topbar-avatar xp-topbar-avatar--fallback">{account.name.trim().charAt(0).toUpperCase()}</span>}
            </button>
          ) : (
            <button type="button" className="xp-seg-btn xp-seg-btn--text xp-topbar-login" onClick={() => onAccountNav('ingresar')}>
              {t('pub_account_nav_login')}
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
