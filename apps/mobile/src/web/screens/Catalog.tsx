import type { ReactNode } from 'react';
import { Ico } from '../icons';
import { linkProps } from '../ui/link';
import { Badge, EmptyPanel, ErrorPanel, FilterChips, KpiRow, LoadingRows, type FilterOption, type KpiView } from '../ui/Page';
import { LoadMore, type LoadMoreState } from '../ui/LoadMore';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface CatalogCardView {
  id: string;
  name: string;
  description: string;
  /** Precio ya formateado. */
  price: string;
  /** URL ya resuelta de la primera foto; `null` = sin foto. */
  photo: string | null;
  published: boolean;
  href: string;
}

export interface CatalogViewProps {
  t: T;
  kpis: KpiView[];
  categories: FilterOption[];
  category: string | null;
  onCategory: (id: string | null) => void;
  cards: CatalogCardView[];
  state: 'loading' | 'error' | 'ready';
  errorMessage?: string;
  onRetry: () => void;
  emptyAction?: ReactNode;
  navigate: (href: string) => void;
  /** Paginación por cursor: "Cargar más" al pie de las tarjetas. */
  pagination?: LoadMoreState;
}

/** Sección Servicios (catálogo): indicadores, filtro por categoría y tarjetas con foto y precio. */
export function CatalogView({ t, kpis, categories, category, onCategory, cards, state, errorMessage, onRetry, emptyAction, navigate, pagination }: CatalogViewProps) {
  useWebStyles();
  return (
    <div className="xw-section">
      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />

      {categories.length > 0 ? <FilterChips label={t('filter_category')} options={categories} value={category} onChange={onCategory} /> : null}

      {state === 'loading' ? <LoadingRows label={t('dash_loading')} rows={4} /> : null}
      {state === 'error' ? <ErrorPanel message={errorMessage ?? t('unknown_error')} retryLabel={t('retry')} onRetry={onRetry} /> : null}
      {state === 'ready' && cards.length === 0 ? <EmptyPanel icon="book-open" title={t('no_items')} text={t('sec_catalog_empty_text')} action={emptyAction} /> : null}

      {state === 'ready' && cards.length > 0 ? (
        <ul className="xw-cards" aria-label={t('sec_catalog_list')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {cards.map((card) => (
            <li key={card.id} className="xw-itemcard">
              <div className="xw-itemcard-photo" aria-hidden="true">
                {card.photo ? <img src={card.photo} alt="" loading="lazy" /> : <Ico name="scissors" size={40} />}
              </div>
              <div className="xw-itemcard-body">
                <a className="xw-itemcard-title" {...linkProps(card.href, navigate)}>
                  {card.name}
                </a>
                {card.description ? <p className="xw-itemcard-desc">{card.description}</p> : null}
                <div className="xw-itemcard-foot">
                  <span className="xw-price">{card.price}</span>
                  {card.published ? null : <Badge tone="muted">{t('hidden_from_catalog')}</Badge>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {state === 'ready' && cards.length > 0 && pagination ? (
        <LoadMore state={pagination} t={t} />
      ) : null}
    </div>
  );
}
