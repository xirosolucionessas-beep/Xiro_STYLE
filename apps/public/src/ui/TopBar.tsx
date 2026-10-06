import { translate, type Language } from '@xiro/shared';
import type { ThemeChoice } from '../lib/theme';
import { Icon } from './Icon';

const THEME_CHOICES: Array<{ value: ThemeChoice; icon: 'monitor' | 'sun' | 'moon'; labelKey: 'pub_topbar_theme_system' | 'pub_topbar_theme_light' | 'pub_topbar_theme_dark' }> = [
  { value: 'system', icon: 'monitor', labelKey: 'pub_topbar_theme_system' },
  { value: 'light', icon: 'sun', labelKey: 'pub_topbar_theme_light' },
  { value: 'dark', icon: 'moon', labelKey: 'pub_topbar_theme_dark' },
];

/**
 * Barra superior de la página pública: controles de tema e idioma, visibles en todas las pantallas (perfil del negocio
 * y gestión de cita). El logo y nombre del negocio, y "Ingresar" cuando existan cuentas de cliente, se agregan aquí
 * mismo más adelante — por ahora la barra solo trae estos dos controles para no bloquear su entrega en eso.
 */
export function TopBar({ language, onLanguageChange, theme, onThemeChange }: { language: Language; onLanguageChange: (next: Language) => void; theme: ThemeChoice; onThemeChange: (next: ThemeChoice) => void }) {
  const t = (key: string) => translate(language, key);
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
      </div>
    </div>
  );
}
