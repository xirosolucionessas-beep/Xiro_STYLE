import type { MouseEvent } from 'react';
import { Ico, type IconName } from '../icons';

type T = (key: string) => string;

export interface HomeAction {
  id: string;
  icon: IconName;
  label: string;
  href?: string;
  soon?: boolean;
}

export function ActionTile({ action, t, navigate }: { action: HomeAction; t: T; navigate: (href: string) => void }) {
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
