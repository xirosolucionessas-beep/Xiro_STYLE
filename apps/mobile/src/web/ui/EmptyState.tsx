import { createElement, type ReactNode } from 'react';
import { Icon, useWebStyles } from './shared';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  /** Nivel de encabezado (h1–h6) según el contexto de la página. */
  headingLevel?: 1 | 2 | 3 | 4;
}

export function EmptyState({ title, description, icon, action, headingLevel = 2 }: EmptyStateProps) {
  useWebStyles();
  return (
    <div className="xw-empty">
      <span className="xw-empty-ic">{icon ?? <Icon name="inbox" size={48} />}</span>
      {createElement(`h${headingLevel}`, { className: 'xw-empty-title' }, title)}
      {description ? <p className="xw-empty-text">{description}</p> : null}
      {action}
    </div>
  );
}
