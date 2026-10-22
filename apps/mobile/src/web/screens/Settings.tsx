import type { ReactNode } from 'react';
import type { Language } from '@xiro/shared';
import { Ico, type IconName } from '../icons';
import { linkProps } from '../ui/link';
import { Panel } from '../ui/Page';
import { cx, useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface SettingsLink {
  id: string;
  icon: IconName;
  title: string;
  sub?: string;
  /** Destino dentro de la app (enlace real). */
  href?: string;
  /** Acción sin destino (p. ej. cerrar sesión, abrir WhatsApp). */
  onPress?: () => void;
  tone?: 'danger';
}

export interface NotificationsModel {
  enabled: boolean;
  loyalty: boolean;
  billing: boolean;
  appointments: boolean;
  reviews: boolean;
  clients: boolean;
  sales: boolean;
  inventory: boolean;
  employees: boolean;
  security: boolean;
  busy: boolean;
  /** Aviso cuando el navegador no permite activarlas (bloqueadas o sin soporte). */
  note?: string;
  onToggle: (next: boolean) => void;
  onLoyalty: (next: boolean) => void;
  onBilling: (next: boolean) => void;
  onAppointments: (next: boolean) => void;
  onReviews: (next: boolean) => void;
  onClients: (next: boolean) => void;
  onSales: (next: boolean) => void;
  onInventory: (next: boolean) => void;
  onEmployees: (next: boolean) => void;
  onSecurity: (next: boolean) => void;
  onTest: () => void;
}

export interface SettingsViewProps {
  t: T;
  accountLinks: SettingsLink[];
  language: Language;
  onLanguage: (next: Language) => void;
  darkMode: boolean;
  onDarkMode: (next: boolean) => void;
  /** Botón flotante del asistente de IA (misma preferencia que en Android/iOS). */
  aiFab?: boolean;
  onAiFab?: (next: boolean) => void;
  /** Botón flotante de contacto por WhatsApp (misma preferencia que en Android/iOS; hoy solo tiene efecto visible en la web). */
  whatsappFab?: boolean;
  onWhatsappFab?: (next: boolean) => void;
  /** null: solo el dueño gestiona las notificaciones del negocio. */
  notifications: NotificationsModel | null;
  supportLinks: SettingsLink[];
  navigate: (href: string) => void;
}

function LinkRow({ link, navigate }: { link: SettingsLink; navigate: (href: string) => void }) {
  const body = (
    <>
      <span className="xw-linkrow-ic" aria-hidden="true">
        <Ico name={link.icon} size={20} />
      </span>
      <span className="xw-linkrow-text">
        <span className="xw-linkrow-title">{link.title}</span>
        {link.sub ? <span className="xw-linkrow-sub">{link.sub}</span> : null}
      </span>
      {link.href ? (
        <span className="xw-linkrow-end" aria-hidden="true">
          <Ico name="chevron-right" size={18} />
        </span>
      ) : null}
    </>
  );
  const className = cx('xw-linkrow', link.tone === 'danger' && 'is-danger');
  return (
    <li>
      {link.href ? (
        <a className={className} {...linkProps(link.href, navigate)}>
          {body}
        </a>
      ) : (
        <button type="button" className={className} onClick={link.onPress}>
          {body}
        </button>
      )}
    </li>
  );
}

/** Fila con interruptor: el control es un botón `role="switch"` con el título como nombre accesible. */
function SwitchRow({ icon, title, sub, checked, onChange, disabled }: { icon: IconName; title: string; sub?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <li className="xw-linkrow" style={{ cursor: 'default' }}>
      <span className="xw-linkrow-ic" aria-hidden="true">
        <Ico name={icon} size={20} />
      </span>
      <span className="xw-linkrow-text">
        <span className="xw-linkrow-title">{title}</span>
        {sub ? <span className="xw-linkrow-sub">{sub}</span> : null}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={title} disabled={disabled} className="xw-switch-hit" onClick={() => onChange(!checked)}>
        <span className="xw-switch-track" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Ajustes: paneles de cuenta y negocio, preferencias, notificaciones y ayuda, con el mismo lenguaje del resto de secciones. */
export function SettingsView({ t, accountLinks, language, onLanguage, darkMode, onDarkMode, aiFab, onAiFab, whatsappFab, onWhatsappFab, notifications, supportLinks, navigate }: SettingsViewProps): ReactNode {
  useWebStyles();
  return (
    <div className="xw-section">
      <div className="xw-panels">
        <Panel title={t('sec_set_business')} icon="user">
          <ul className="xw-linklist">
            {accountLinks.map((link) => (
              <LinkRow key={link.id} link={link} navigate={navigate} />
            ))}
          </ul>
        </Panel>

        <div className="xw-dash-col">
          <Panel title={t('sec_set_prefs')} icon="sliders">
            <ul className="xw-linklist">
              <li className="xw-linkrow" style={{ cursor: 'default' }}>
                <span className="xw-linkrow-ic" aria-hidden="true">
                  <Ico name="globe" size={20} />
                </span>
                <span className="xw-linkrow-text">
                  <span className="xw-linkrow-title" id="xw-lang-label">
                    {t('language')}
                  </span>
                  <span className="xw-linkrow-sub">{t('sec_set_language_desc')}</span>
                </span>
                <div className="xw-fchips" role="group" aria-labelledby="xw-lang-label">
                  <button type="button" className="xw-fchip" aria-pressed={language === 'es'} onClick={() => onLanguage('es')}>
                    {t('language_es')}
                  </button>
                  <button type="button" className="xw-fchip" aria-pressed={language === 'en'} onClick={() => onLanguage('en')}>
                    {t('language_en')}
                  </button>
                </div>
              </li>
              <SwitchRow icon={darkMode ? 'moon' : 'sun'} title={t('dark_mode')} sub={t('sec_set_dark_desc')} checked={darkMode} onChange={onDarkMode} />
              {onAiFab ? <SwitchRow icon="message-circle" title={t('ai_show_fab')} sub={t('sec_set_ai_desc')} checked={aiFab ?? true} onChange={onAiFab} /> : null}
              {onWhatsappFab ? <SwitchRow icon="phone" title={t('whatsapp_show_fab')} sub={t('whatsapp_show_fab_desc')} checked={whatsappFab ?? true} onChange={onWhatsappFab} /> : null}
            </ul>
          </Panel>

          {notifications ? (
            <Panel title={t('sec_set_notifs')} icon="bell" sub={notifications.note ?? t('sec_set_notifs_desc')}>
              <ul className="xw-linklist">
                <SwitchRow icon="bell" title={t('notifications_enable_cta')} checked={notifications.enabled} onChange={notifications.onToggle} disabled={notifications.busy} />
                {notifications.enabled ? (
                  <>
                    <SwitchRow icon="calendar-days" title={t('notifications_category_appointments')} checked={notifications.appointments} onChange={notifications.onAppointments} disabled={notifications.busy} />
                    <SwitchRow icon="message-square" title={t('notifications_category_reviews')} checked={notifications.reviews} onChange={notifications.onReviews} disabled={notifications.busy} />
                    <SwitchRow icon="star" title={t('notifications_category_loyalty')} checked={notifications.loyalty} onChange={notifications.onLoyalty} disabled={notifications.busy} />
                    <SwitchRow icon="credit-card" title={t('notifications_category_billing')} checked={notifications.billing} onChange={notifications.onBilling} disabled={notifications.busy} />
                    <SwitchRow icon="users" title={t('notifications_category_clients')} checked={notifications.clients} onChange={notifications.onClients} disabled={notifications.busy} />
                    <SwitchRow icon="wallet" title={t('notifications_category_sales')} checked={notifications.sales} onChange={notifications.onSales} disabled={notifications.busy} />
                    <SwitchRow icon="package" title={t('notifications_category_inventory')} checked={notifications.inventory} onChange={notifications.onInventory} disabled={notifications.busy} />
                    <SwitchRow icon="briefcase" title={t('notifications_category_employees')} checked={notifications.employees} onChange={notifications.onEmployees} disabled={notifications.busy} />
                    <SwitchRow icon="shield-check" title={t('notifications_category_security')} checked={notifications.security} onChange={notifications.onSecurity} disabled={notifications.busy} />
                    <LinkRow link={{ id: 'test', icon: 'send', title: t('notifications_test_cta'), onPress: notifications.onTest }} navigate={navigate} />
                  </>
                ) : null}
              </ul>
            </Panel>
          ) : null}
        </div>

        <Panel title={t('sec_set_support')} icon="info" className="xw-span-all">
          <ul className="xw-linklist">
            {supportLinks.map((link) => (
              <LinkRow key={link.id} link={link} navigate={navigate} />
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
