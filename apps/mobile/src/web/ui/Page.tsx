import type { ReactNode } from 'react';
import type { TrendDirection } from '../../lib/dashboard';
import { Ico, type IconName } from '../icons';
import { cx, useWebStyles } from './shared';

/**
 * Piezas del sistema de diseño oscuro/dorado compartidas por TODAS las pantallas de la web (Inicio, Clientes, Servicios,
 * Inventario…): tarjetas de indicador, paneles, filtros, buscador, avatar e insignias. Puras: todo llega por props.
 */

type T = (key: string, params?: Record<string, string | number>) => string;

/* ---------- Indicador (KPI) ---------- */

export interface KpiView {
  id: string;
  icon: IconName;
  label: string;
  value: string;
  loading?: boolean;
  /** Variación frente a ayer; siempre con texto (nunca solo color ni solo flecha). */
  trend?: { direction: TrendDirection; text: string };
  hint?: string;
  /** Tono del valor cuando el dato es una alerta (p. ej. agotados). */
  tone?: 'success' | 'warning' | 'danger';
  onPress?: () => void;
}

function Trend({ trend, srSuffix }: { trend: NonNullable<KpiView['trend']>; srSuffix: string }) {
  if (trend.direction === 'none') return null;
  const icon: IconName = trend.direction === 'up' ? 'trending-up' : trend.direction === 'down' ? 'trending-down' : 'activity';
  return (
    <span className={cx('xw-trend', `is-${trend.direction}`)}>
      <Ico name={icon} size={14} />
      <span>{trend.text}</span>
      <span className="xw-sr">{srSuffix}</span>
    </span>
  );
}

export function KpiCard({ kpi, loadingLabel, trendSuffix }: { kpi: KpiView; loadingLabel: string; trendSuffix: string }) {
  useWebStyles();
  const body = (
    <>
      <span className={cx('xw-kpi-ic', kpi.tone && `is-${kpi.tone}`)} aria-hidden="true">
        <Ico name={kpi.icon} size={22} />
      </span>
      <span className="xw-kpi-label">{kpi.label}</span>
      {kpi.loading ? <span className="xw-skeleton xw-kpi-skel" aria-hidden="true" /> : <span className="xw-kpi-value">{kpi.value}</span>}
      {kpi.loading ? <span className="xw-sr">{loadingLabel}</span> : null}
      {!kpi.loading && kpi.trend ? <Trend trend={kpi.trend} srSuffix={trendSuffix} /> : null}
      {!kpi.loading && kpi.hint ? <span className="xw-kpi-hint">{kpi.hint}</span> : null}
    </>
  );
  return kpi.onPress ? (
    <button type="button" className="xw-kpi xw-kpi--action" onClick={kpi.onPress}>
      {body}
    </button>
  ) : (
    <div className="xw-kpi">{body}</div>
  );
}

export function KpiRow({ kpis, label, t }: { kpis: KpiView[]; label: string; t: T }) {
  if (kpis.length === 0) return null;
  return (
    <section aria-label={label} className="xw-kpis">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.id} kpi={kpi} loadingLabel={t('dash_loading')} trendSuffix={t('dash_vs_yesterday')} />
      ))}
    </section>
  );
}

/* ---------- Panel ---------- */

export function Panel({ title, icon, action, children, className, sub }: { title: string; icon?: IconName; action?: ReactNode; children: ReactNode; className?: string; sub?: string }) {
  useWebStyles();
  return (
    <section className={cx('xw-panel', className)}>
      <header className="xw-panel-head">
        <h2 className="xw-panel-title">
          {icon ? (
            <span className="xw-panel-ic" aria-hidden="true">
              <Ico name={icon} size={18} />
            </span>
          ) : null}
          {title}
        </h2>
        {action}
      </header>
      {sub ? <p className="xw-panel-sub">{sub}</p> : null}
      {children}
    </section>
  );
}

/* ---------- Filtros y búsqueda ---------- */

export interface FilterOption {
  id: string;
  label: string;
}

/** Filtro de una sola opción: botones con `aria-pressed` dentro de un grupo con nombre (teclado nativo: Tab + Espacio/Enter). */
export function FilterChips({ label, options, value, onChange }: { label: string; options: FilterOption[]; value: string | null; onChange: (id: string | null) => void }) {
  useWebStyles();
  return (
    <div className="xw-fchips" role="group" aria-label={label}>
      <span className="xw-fchips-label" aria-hidden="true">
        {label}
      </span>
      {options.map((option) => (
        <button key={option.id} type="button" className="xw-fchip" aria-pressed={value === option.id} onClick={() => onChange(value === option.id ? null : option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  useWebStyles();
  return (
    <div className="xw-searchfield">
      <span className="xw-searchfield-ic" aria-hidden="true">
        <Ico name="search" size={18} />
      </span>
      <input type="search" className="xw-searchfield-input" aria-label={label} placeholder={placeholder ?? label} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/* ---------- Avatar e insignias ---------- */

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  useWebStyles();
  return (
    <span className="xw-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** Insignia de estado: el significado va SIEMPRE en el texto (el color y el punto solo refuerzan). */
export function Badge({ tone = 'muted', children }: { tone?: 'success' | 'warning' | 'danger' | 'accent' | 'muted'; children: ReactNode }) {
  useWebStyles();
  return (
    <span className={cx('xw-badge', `is-${tone}`)}>
      <span className="xw-badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/* ---------- Estados ---------- */

export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="xw-rows-loading" role="status">
      <span className="xw-sr">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="xw-skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

/** Estado vacío dentro de un panel: icono, mensaje y (opcional) acción. */
export function EmptyPanel({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  useWebStyles();
  return (
    <div className="xw-emptypanel">
      <span className="xw-emptypanel-ic" aria-hidden="true">
        <Ico name={icon} size={30} />
      </span>
      <p className="xw-emptypanel-title">{title}</p>
      {text ? <p className="xw-panel-empty">{text}</p> : null}
      {action}
    </div>
  );
}

export function ErrorPanel({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  useWebStyles();
  return (
    <div className="xw-errorpanel" role="alert">
      <span className="xw-errorpanel-ic" aria-hidden="true">
        <Ico name="triangle-alert" size={22} />
      </span>
      <span className="xw-errorpanel-msg">{message}</span>
      <button type="button" className="xw-btn xw-btn--secondary xw-btn--sm" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}
