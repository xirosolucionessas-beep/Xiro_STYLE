import { useRef, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Actor } from '@xiro/shared';
import { meets } from '../../lib/access';
import { layout, remOf } from '../tokens';
import { Button } from '../ui/Button';
import { cx, Icon, useWebStyles } from '../ui/shared';
import { useDialogBehavior } from '../ui/useDialogBehavior';
import { NAV_ITEMS, type NavItem } from './nav';
import type { RouteInfo } from './routes';
import { Tooltip } from './Tooltip';

export type ShellMode = 'desktop' | 'tablet' | 'mobile';

export interface ShellViewProps {
  mode: ShellMode;
  /** Preferencia del usuario (solo aplica en escritorio; en tablet siempre va colapsada). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  route: RouteInfo;
  t: (key: string, params?: Record<string, string | number>) => string;
  signedIn: boolean;
  /** Quién usa la app: oculta del menú lo que no puede usar. Sin él, se muestra todo. */
  actor?: Actor | null;
  /** `logo` lo aporta el contenedor (imagen del negocio o la de la marca); es decorativo junto al nombre. */
  brand: { name: string; logo?: ReactNode };
  navigate: (href: string) => void;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  /** Texto anunciado (aria-live) al cambiar de página. */
  announcement: string;
  mainRef: RefObject<HTMLElement | null>;
  /** Estado de datos: barra de carga y aviso de error con reintento. */
  status?: ShellStatus;
  /** Cabecera del rediseño: buscador global (centro) y herramientas (campana, mensajes, perfil) a la derecha. Solo con sesión. */
  headerSearch?: ReactNode;
  headerTools?: ReactNode;
  /** Tarjeta extra al pie de la barra lateral (p. ej. el plan). Se oculta con la barra colapsada. */
  sidebarExtra?: ReactNode;
  /** Botones flotantes (soporte de WhatsApp, asistente…). Solo se muestran con sesión iniciada. */
  floating?: ReactNode;
  children: ReactNode;
}

export interface ShellStatus {
  busy: boolean;
  error?: { message: string; retryLabel: string; onRetry: () => void };
}

/** Deja pasar clics con modificador o botón central (abrir en pestaña nueva); el resto navega sin recargar. */
function linkHandler(href: string, navigate: (href: string) => void, after?: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
    after?.();
  };
}

function NavList({ route, t, navigate, collapsed, onNavigate, actor }: { route: RouteInfo; t: (key: string, params?: Record<string, string | number>) => string; navigate: (href: string) => void; collapsed: boolean; onNavigate?: () => void; actor?: Actor | null }) {
  const renderItem = (item: NavItem) => {
    const label = t(item.labelKey);
    const icon = <Icon name={item.icon} size={22} />;
    const text = <span className={collapsed ? 'xw-sr' : 'xw-nav-label'}>{label}</span>;

    if (item.soon || !item.href) {
      return (
        <li key={item.id}>
          <Tooltip label={`${label} · ${t('soon')}`} enabled={collapsed}>
            {/* Sin href: no es un enlace ni entra en el orden de tabulación; se anuncia como no disponible. */}
            <span className="xw-nav-item is-disabled" role="link" aria-disabled="true">
              {icon}
              {collapsed ? (
                <span className="xw-sr">{`${label}, ${t('soon')}`}</span>
              ) : (
                <span className="xw-nav-stack">
                  <span className="xw-nav-label">{label}</span>
                  <span className="xw-nav-soon">{t('soon')}</span>
                </span>
              )}
            </span>
          </Tooltip>
        </li>
      );
    }

    const current = item.section !== undefined && item.section === route.section;
    return (
      <li key={item.id}>
        <Tooltip label={label} enabled={collapsed}>
          <a className="xw-nav-item" href={item.href} aria-current={current ? 'page' : undefined} onClick={linkHandler(item.href, navigate, onNavigate)}>
            {icon}
            {text}
          </a>
        </Tooltip>
      </li>
    );
  };

  return <ul className="xw-nav-list">{NAV_ITEMS.filter((item) => meets(actor, item.requires)).map(renderItem)}</ul>;
}

function Brand({ brand, collapsed }: { brand: ShellViewProps['brand']; collapsed: boolean }) {
  return (
    <div className="xw-brand">
      <span className="xw-logo" aria-hidden="true">
        {brand.logo ?? <span className="xw-logo-fallback" />}
      </span>
      <span className={collapsed ? 'xw-sr' : 'xw-brand-name'}>{brand.name}</span>
    </div>
  );
}

function Breadcrumbs({ route, t, navigate }: { route: RouteInfo; t: (key: string) => string; navigate: (href: string) => void }) {
  return (
    <nav className="xw-crumbs" aria-label={t('breadcrumb')}>
      <ol>
        {route.trail.map((crumb, index) => {
          const last = index === route.trail.length - 1;
          return (
            <li key={`${crumb.labelKey}-${index}`}>
              {last || !crumb.href ? (
                <span aria-current={last ? 'page' : undefined}>{t(crumb.labelKey)}</span>
              ) : (
                <a href={crumb.href} onClick={linkHandler(crumb.href, navigate)}>
                  {t(crumb.labelKey)}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Drawer({ open, onClose, route, t, navigate, brand, actor }: { open: boolean; onClose: () => void; route: RouteInfo; t: (key: string) => string; navigate: (href: string) => void; brand: ShellViewProps['brand']; actor?: Actor | null }) {
  const panel = useRef<HTMLElement>(null);
  useDialogBehavior(open, panel, onClose);
  if (!open) return null;
  return createPortal(
    <div
      role="presentation"
      data-xw-portal=""
      className="xw-drawer-root"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <nav ref={panel} id="xw-drawer" className="xw-drawer" aria-label={t('main_nav')} tabIndex={-1}>
        <div className="xw-drawer-head">
          <Brand brand={brand} collapsed={false} />
          <button type="button" className="xw-icon-btn" style={{ marginRight: 0 }} aria-label={t('close_menu')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <NavList route={route} t={t} navigate={navigate} collapsed={false} onNavigate={onClose} actor={actor} />
      </nav>
    </div>,
    document.body,
  );
}

/**
 * Estructura de página de la web: enlace "Saltar al contenido", barra lateral persistente (escritorio),
 * iconos con tooltip (tablet), drawer (móvil), migas de pan y <main>. Componente puro: recibe todo por props.
 */
export function ShellView({ mode, collapsed, onToggleCollapsed, route, t, signedIn, actor, brand, navigate, drawerOpen, onDrawerOpenChange, announcement, mainRef, status, headerSearch, headerTools, sidebarExtra, floating, children }: ShellViewProps) {
  useWebStyles();
  // `standalone`: pantalla completa aun con sesión iniciada (p. ej. elegir plan) — sin sidebar ni barra de migas,
  // como si fuera una pantalla de autenticación.
  // Las páginas de acceso y las legales (Términos, Privacidad) van a ventana completa aunque haya sesión iniciada.
  const chrome = signedIn && !route.standalone && !route.auth;
  const showSidebar = chrome && mode !== 'mobile';
  const iconsOnly = mode === 'tablet' || (mode === 'desktop' && collapsed);
  const pageWidth = route.bleed ? 'bleed' : route.auth ? 'auth' : route.width === 'form' ? 'form' : 'default';
  const maxWidth = route.bleed ? '100%' : route.auth ? remOf(layout.maxForm) : route.width === 'form' ? remOf(layout.maxFormPage) : remOf(layout.maxContent);

  return (
    <div className="xw-app" data-mode={mode}>
      <a
        className="xw-skip"
        href="#xw-main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}>
        {t('skip_to_content')}
      </a>

      {showSidebar ? (
        <nav id="xw-sidebar" className={cx('xw-sidebar')} data-collapsed={iconsOnly} aria-label={t('main_nav')}>
          <Brand brand={brand} collapsed={iconsOnly} />
          <NavList route={route} t={t} navigate={navigate} collapsed={iconsOnly} actor={actor} />
          {sidebarExtra && !iconsOnly ? <div className="xw-side-extra">{sidebarExtra}</div> : null}
          {mode === 'desktop' ? (
            <button type="button" className="xw-collapse" aria-expanded={!collapsed} aria-controls="xw-sidebar" onClick={onToggleCollapsed}>
              <Icon name={collapsed ? 'chevrons-right' : 'chevrons-left'} />
              <span className={iconsOnly ? 'xw-sr' : undefined}>{collapsed ? t('expand_sidebar') : t('collapse_sidebar')}</span>
            </button>
          ) : null}
        </nav>
      ) : null}

      <div className="xw-col">
        {chrome ? (
          <header className="xw-topbar">
            {mode === 'mobile' ? (
              <button type="button" className="xw-icon-btn xw-menu-btn" aria-expanded={drawerOpen} aria-controls="xw-drawer" aria-label={t('open_menu')} onClick={() => onDrawerOpenChange(true)}>
                <Icon name="menu" size={24} />
              </button>
            ) : null}
            <Breadcrumbs route={route} t={t} navigate={navigate} />
            {headerSearch || headerTools ? (
              <>
                <div className="xw-topbar-search">{headerSearch}</div>
                <div className="xw-topbar-tools">{headerTools}</div>
              </>
            ) : null}
          </header>
        ) : null}

        <main id="xw-main" ref={mainRef} tabIndex={-1} className="xw-main" data-page-width={pageWidth} data-standalone={route.standalone ? 'true' : undefined} style={{ '--xw-page-max': maxWidth } as CSSProperties}>
          {status?.busy ? <div className="xw-progress" aria-hidden="true" /> : null}
          {status?.error && !route.inlineErrors ? (
            <div role="alert" className="xw-banner">
              <span className="xw-banner-ic">
                <Icon name="alert" />
              </span>
              <span className="xw-banner-msg">{status.error.message}</span>
              <Button variant="secondary" size="sm" onPress={status.error.onRetry}>
                {status.error.retryLabel}
              </Button>
            </div>
          ) : null}
          {route.needsHeading ? <h1 className="xw-sr">{t(route.titleKey)}</h1> : null}
          {children}
        </main>
      </div>

      {chrome && mode === 'mobile' ? <Drawer open={drawerOpen} onClose={() => onDrawerOpenChange(false)} route={route} t={t} navigate={navigate} brand={brand} actor={actor} /> : null}

      {signedIn && floating ? <div className="xw-fab-stack">{floating}</div> : null}

      <div className="xw-sr" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
