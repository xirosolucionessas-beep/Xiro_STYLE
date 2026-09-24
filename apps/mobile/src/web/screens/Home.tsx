import type { Currency } from '@xiro/shared';
import { formatMoney } from '@xiro/shared';
import type { MouseEvent, ReactNode } from 'react';
import { Ico, type IconName } from '../icons';
import { useWebStyles } from '../ui/shared';

type T = (key: string) => string;

export interface HomeAction {
  id: string;
  icon: IconName;
  label: string;
  href?: string;
  soon?: boolean;
}

export interface HomeViewProps {
  t: T;
  userName: string;
  /** "@slug" del negocio (identifica la cuenta; no hay un ID de cuenta separado). */
  businessSlug: string;
  /** Logo del negocio, ya resuelto por el contenedor (Brand con la imagen real o el logo por defecto). */
  logo: ReactNode;
  onChangeLogo: () => void;
  logoBusy: boolean;
  onEditProfile: () => void;
  /** null: la caja no se ha abierto hoy. */
  balanceAmount: number | null;
  currency: Currency;
  onOpenCash: () => void;
  /** false: el empleado no ve la caja del día (dato del dueño). */
  showBalance?: boolean;
  needsWhatsappSetup: boolean;
  onGoBusinessSettings: () => void;
  actions: HomeAction[];
  navigate: (href: string) => void;
}

function ActionTile({ action, t, navigate }: { action: HomeAction; t: T; navigate: (href: string) => void }) {
  if (action.soon || !action.href) {
    return (
      <span className="xw-tile" role="link" aria-disabled="true">
        <span className="xw-tile-ic" aria-hidden="true">
          <Ico name={action.icon} size={22} />
        </span>
        <span className="xw-tile-bottom">
          <span className="xw-tile-label">{action.label}</span>
          <span className="xw-tile-soon">{t('soon')}</span>
        </span>
      </span>
    );
  }

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(action.href!);
  };
  return (
    <a className="xw-tile" href={action.href} onClick={onClick}>
      <span className="xw-tile-ic" aria-hidden="true">
        <Ico name={action.icon} size={22} />
      </span>
      <span className="xw-tile-bottom">
        <span className="xw-tile-label">{action.label}</span>
        <span className="xw-tile-chevron" aria-hidden="true">
          <Ico name="chevron-right" size={18} />
        </span>
      </span>
    </a>
  );
}

/** Panel de inicio web (sección 5): cabecera de cuenta, balance del día, aviso de configuración y accesos rápidos. */
export function HomeView({ t, userName, businessSlug, logo, onChangeLogo, logoBusy, onEditProfile, balanceAmount, currency, onOpenCash, showBalance = true, needsWhatsappSetup, onGoBusinessSettings, actions, navigate }: HomeViewProps) {
  useWebStyles();
  const initial = userName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="xw-home">
      <div className="xw-home-top">
        <div className="xw-home-brand">
          <span className="xw-home-logo">{logo}</span>
          <button type="button" className="xw-home-cam" aria-label={t('logo_change')} disabled={logoBusy} onClick={onChangeLogo}>
            {logoBusy ? <span className="xw-spinner" aria-hidden="true" /> : <Ico name="camera" size={14} />}
          </button>
        </div>
        <button type="button" className="xw-home-account" aria-label={t('edit_profile')} onClick={onEditProfile}>
          <span className="xw-home-account-text">
            <span className="xw-home-name">{userName}</span>
            <span className="xw-home-sub">
              {t('account_of')} · @{businessSlug}
            </span>
          </span>
          <span className="xw-home-avatar" aria-hidden="true">
            {initial}
          </span>
        </button>
      </div>

      <p className="xw-home-today">{t('today')}</p>

      {showBalance ? (
      <button type="button" className="xw-balance xw-scope-dark" onClick={onOpenCash}>
        <span className="xw-balance-ic" aria-hidden="true">
          <Ico name="wallet" size={26} />
        </span>
        <span className="xw-balance-body">
          <span className="xw-balance-label">{t('available_balance')}</span>
          <span className="xw-balance-amount">{balanceAmount !== null ? formatMoney(balanceAmount, currency) : '—'}</span>
          {balanceAmount === null ? <span className="xw-balance-hint">{t('cash_not_opened')}</span> : null}
        </span>
        <span className="xw-balance-chevron" aria-hidden="true">
          <Ico name="chevron-right" size={20} />
        </span>
      </button>
      ) : null}

      {needsWhatsappSetup ? (
        <button type="button" className="xw-card xw-setup" onClick={onGoBusinessSettings}>
          <span className="xw-setup-ic" aria-hidden="true">
            <Ico name="message-square" size={20} />
          </span>
          <span className="xw-setup-text">
            <span className="xw-tile-label">{t('business_settings')}</span>
            <br />
            <span className="xw-home-sub">{t('business_whatsapp')}</span>
          </span>
          <span className="xw-setup-chevron" aria-hidden="true">
            <Ico name="chevron-right" size={18} />
          </span>
        </button>
      ) : null}

      <div>
        <p className="xw-actions-title">{t('quick_actions')}</p>
        <div className="xw-actions-grid">
          {actions.map((action) => (
            <ActionTile key={action.id} action={action} t={t} navigate={navigate} />
          ))}
        </div>
      </div>
    </div>
  );
}
