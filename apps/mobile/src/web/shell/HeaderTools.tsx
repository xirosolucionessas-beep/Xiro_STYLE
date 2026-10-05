import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Ico, type IconName } from '../icons';
import { resolveMedia } from '../media';
import { cx } from '../ui/shared';

export type HeaderT = (key: string, params?: Record<string, string | number>) => string;

/**
 * Popover de cabecera: se cierra con Escape (devolviendo el foco al botón), clic fuera o al mover el foco fuera de él.
 * Los elementos se guardan en estado (callback refs) para no leer refs durante el render.
 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !root) return;
    const outside = (event: Event) => {
      if (!root.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, root, button]);

  const close = useCallback(() => setOpen(false), []);
  return { open, close, setRoot, setButton, toggle: () => setOpen((value) => !value) };
}

/* ---------------- Botón con panel (campana, mensajes) ---------------- */

function PopoverButton({ label, icon, badge, title, children, footer }: { label: string; icon: IconName; badge?: string; title: string; children: (close: () => void) => ReactNode; footer?: (close: () => void) => ReactNode }) {
  const { open, close, setRoot, setButton, toggle } = usePopover();
  const panelId = useId();
  return (
    <div className="xw-pop" ref={setRoot}>
      <button ref={setButton} type="button" className="xw-tool" aria-label={label} aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="true" onClick={toggle}>
        <Ico name={icon} size={22} />
        {badge ? (
          <span className="xw-tool-badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={panelId} className="xw-pop-panel" role="region" aria-label={title}>
          <div className="xw-pop-head">
            <h2 className="xw-pop-title">{title}</h2>
          </div>
          <div className="xw-pop-body">{children(close)}</div>
          {footer ? <div className="xw-pop-foot">{footer(close)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Campanita ---------------- */

export interface NotificationRow {
  id: string;
  title: string;
  detail?: string;
  /** "hace 10 min". */
  time?: string;
  priority: 'urgent' | 'warning' | 'info';
  unread: boolean;
  href: string;
}

export interface NotificationsMenuProps {
  t: HeaderT;
  rows: NotificationRow[];
  /** Cuántas hay sin leer: coincide con la insignia y con la pantalla de Notificaciones. */
  pending: number;
  badge: string;
  loading?: boolean;
  onOpenRow: (row: NotificationRow) => void;
  onReadAll: () => void;
  onViewAll: () => void;
}

export function NotificationsMenu({ t, rows, pending, badge, loading, onOpenRow, onReadAll, onViewAll }: NotificationsMenuProps) {
  const label = pending > 0 ? t('notif_bell_label', { n: pending }) : t('notif_bell_none');
  return (
    <PopoverButton
      label={label}
      icon="bell"
      badge={badge}
      title={t('hdr_notifications')}
      footer={(close) => (
        <>
          {pending > 0 ? (
            <button type="button" className="xw-link-btn" onClick={onReadAll}>
              {t('notif_mark_all')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="xw-link-btn"
            onClick={() => {
              close();
              onViewAll();
            }}>
            {t('hdr_notif_view_all')}
          </button>
        </>
      )}>
      {(close) => (
        <>
      {loading ? <p className="xw-pop-empty">{t('dash_loading')}</p> : null}
      {!loading && rows.length === 0 ? <p className="xw-pop-empty">{t('hdr_notif_empty')}</p> : null}
      <ul className="xw-pop-list">
        {rows.map((row) => (
          <li key={row.id}>
            <a
              className="xw-notif"
              href={row.href}
              data-unread={row.unread}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                close();
                onOpenRow(row);
              }}>
              <span className={cx('xw-notif-dot', `is-${row.priority}`)} aria-hidden="true" />
              <span className="xw-notif-text">
                <span className="xw-notif-title">{row.title}</span>
                {row.detail ? <span className="xw-notif-detail">{row.detail}</span> : null}
                {row.time ? <span className="xw-notif-time">{row.time}</span> : null}
              </span>
              {row.unread ? <span className="xw-sr">·</span> : null}
            </a>
          </li>
        ))}
      </ul>
        </>
      )}
    </PopoverButton>
  );
}

/* ---------------- Mensajes ---------------- */

export interface MessageRow {
  id: string;
  peerName: string;
  peerPhotoUrl: string | null;
  /** "Tú: ..." si el último mensaje lo escribió quien mira esto. */
  preview: string;
  time: string;
  unread: boolean;
}

export interface MessagesMenuProps {
  t: HeaderT;
  rows: MessageRow[];
  unreadCount: number;
  badge: string;
  loading?: boolean;
  onOpenRow: (id: string) => void;
  onViewAll: () => void;
}

export function MessagesMenu({ t, rows, unreadCount, badge, loading, onOpenRow, onViewAll }: MessagesMenuProps) {
  const label = unreadCount > 0 ? t('msg_unread_label', { n: unreadCount }) : t('messages_title');
  return (
    <PopoverButton
      label={label}
      icon="message-square"
      badge={badge}
      title={t('messages_title')}
      footer={(close) => (
        <button
          type="button"
          className="xw-link-btn"
          onClick={() => {
            close();
            onViewAll();
          }}>
          {t('msg_view_all')}
        </button>
      )}>
      {(close) => (
        <>
          {loading ? <p className="xw-pop-empty">{t('dash_loading')}</p> : null}
          {!loading && rows.length === 0 ? (
            <div className="xw-pop-empty-block">
              <span className="xw-pop-empty-ic" aria-hidden="true">
                <Ico name="message-circle" size={28} />
              </span>
              <p className="xw-pop-empty-title">{t('msg_list_empty_title')}</p>
              <p className="xw-pop-empty">{t('msg_list_empty_text')}</p>
            </div>
          ) : null}
          <ul className="xw-pop-list">
            {rows.map((row) => {
              const peerPhoto = resolveMedia(row.peerPhotoUrl);
              return (
              <li key={row.id}>
                <button
                  type="button"
                  className="xw-notif xw-msg-row"
                  data-unread={row.unread}
                  onClick={() => {
                    close();
                    onOpenRow(row.id);
                  }}>
                  <span className="xw-avatar" aria-hidden="true">
                    {peerPhoto ? <img src={peerPhoto} alt="" className="xw-avatar-img" /> : row.peerName.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <span className="xw-notif-text">
                    <span className="xw-notif-title">{row.peerName}</span>
                    <span className="xw-notif-detail">{row.preview}</span>
                    <span className="xw-notif-time">{row.time}</span>
                  </span>
                  {row.unread ? <span className="xw-sr">·</span> : null}
                </button>
              </li>
              );
            })}
          </ul>
        </>
      )}
    </PopoverButton>
  );
}

/* ---------------- Perfil ---------------- */

export interface ProfileMenuProps {
  t: HeaderT;
  name: string;
  photoUrl: string | null;
  roleLabel: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onProfile: () => void;
  onLogout: () => void;
  /** "Mi plan": ausente para un empleado (solo el dueño gestiona el plan). Acceso discreto, exista o no la tarjeta de la barra lateral. */
  onPlan?: () => void;
  /** En pantallas estrechas solo se ve el avatar. */
  compact?: boolean;
}

export function ProfileMenu({ t, name, photoUrl, roleLabel, theme, onToggleTheme, onProfile, onPlan, onLogout, compact }: ProfileMenuProps) {
  const { open, close, setRoot, setButton, toggle } = usePopover();
  const panelId = useId();
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  // resolveMedia: el servidor devuelve una ruta relativa ("/media/xxx.webp"); en el servidor de desarrollo de Expo
  // (puerto 8081) el navegador la resolvería contra SU PROPIO origen en vez del de la API (puerto 3000) y la foto
  // nunca cargaría — mismo motivo por el que el logo del negocio (Brand.tsx) y las fotos del catálogo ya la usan.
  const resolvedPhoto = resolveMedia(photoUrl);
  const avatar = resolvedPhoto ? <img src={resolvedPhoto} alt="" className="xw-avatar-img" /> : initial;
  return (
    <div className="xw-pop" ref={setRoot}>
      <button ref={setButton} type="button" className="xw-profile-btn" aria-label={`${t('hdr_profile_menu')}: ${name}`} aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="true" onClick={toggle}>
        <span className="xw-avatar" aria-hidden="true">
          {avatar}
        </span>
        {compact ? null : (
          <span className="xw-profile-text">
            <span className="xw-profile-name">{name}</span>
            <span className="xw-profile-role">{roleLabel}</span>
          </span>
        )}
        {compact ? null : <Ico name="chevron-down" size={16} />}
      </button>
      {open ? (
        <div id={panelId} className="xw-pop-panel xw-pop-panel--menu" role="region" aria-label={t('hdr_profile_menu')}>
          <div className="xw-menu-id">
            <span className="xw-avatar xw-avatar--lg" aria-hidden="true">
              {avatar}
            </span>
            <span className="xw-profile-text">
              <span className="xw-profile-name">{name}</span>
              <span className="xw-profile-role">{roleLabel}</span>
            </span>
          </div>
          <button
            type="button"
            className="xw-menu-item"
            onClick={() => {
              close();
              onProfile();
            }}>
            <Ico name="user" size={20} />
            {t('hdr_my_profile')}
          </button>
          {onPlan ? (
            <button
              type="button"
              className="xw-menu-item"
              onClick={() => {
                close();
                onPlan();
              }}>
              <Ico name="crown" size={20} />
              {t('hdr_my_plan')}
            </button>
          ) : null}
          <button type="button" className="xw-menu-item" role="switch" aria-checked={theme === 'light'} onClick={onToggleTheme}>
            <Ico name={theme === 'dark' ? 'moon' : 'sun'} size={20} />
            <span className="xw-menu-grow">{t('hdr_theme')}</span>
            <span className="xw-menu-value">{theme === 'dark' ? t('hdr_theme_dark') : t('hdr_theme_light')}</span>
          </button>
          <button
            type="button"
            className="xw-menu-item xw-menu-item--danger"
            onClick={() => {
              close();
              onLogout();
            }}>
            <Ico name="log-out" size={20} />
            {t('logout')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Buscador global ---------------- */

export interface SearchRow {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  kind: 'client' | 'item';
}

export interface HeaderSearchProps {
  t: HeaderT;
  query: string;
  onQueryChange: (value: string) => void;
  /** Consulta lo bastante larga como para buscar (≥ 2 letras). */
  searchable: boolean;
  loading: boolean;
  clients: SearchRow[];
  items: SearchRow[];
  onOpenRow: (row: SearchRow) => void;
  /** Móvil: el buscador se abre en su propia fila y trae botón de cerrar. */
  onClose?: () => void;
}

/** Combobox accesible (ARIA 1.2): flechas mueven la opción activa, Enter la abre, Escape cierra. */
export function HeaderSearch({ t, query, onQueryChange, searchable, loading, clients, items, onOpenRow, onClose }: HeaderSearchProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const rows = [...clients, ...items];
  const expanded = open && query.trim().length > 0;

  useEffect(() => {
    if (!expanded) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [expanded]);

  const choose = (row: SearchRow) => {
    setOpen(false);
    onQueryChange('');
    onClose?.();
    onOpenRow(row);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && rows.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((value) => (value + 1) % rows.length);
    } else if (event.key === 'ArrowUp' && rows.length > 0) {
      event.preventDefault();
      setActive((value) => (value - 1 + rows.length) % rows.length);
    } else if (event.key === 'Enter' && expanded && rows[active]) {
      event.preventDefault();
      choose(rows[active]!);
    } else if (event.key === 'Escape') {
      if (expanded) event.stopPropagation();
      setOpen(false);
      if (!expanded) onClose?.();
    }
  };

  const summary = !searchable ? t('hdr_search_hint') : loading && rows.length === 0 ? t('hdr_search_loading') : rows.length === 0 ? t('hdr_search_none', { q: query.trim() }) : rows.length === 1 ? t('hdr_search_result_one') : t('hdr_search_results', { n: rows.length });
  const group = (title: string, list: SearchRow[], offset: number) =>
    list.length === 0 ? null : (
      <div role="group" aria-label={title}>
        <p className="xw-search-group" aria-hidden="true">
          {title}
        </p>
        <div>
          {list.map((row, index) => (
            <div key={row.id} role="presentation">
              <a
                id={`${listId}-${offset + index}`}
                role="option"
                aria-selected={active === offset + index}
                className={cx('xw-result', active === offset + index && 'is-active')}
                href={row.href}
                tabIndex={-1}
                onMouseEnter={() => setActive(offset + index)}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  choose(row);
                }}>
                <span className="xw-result-ic" aria-hidden="true">
                  <Ico name={row.kind === 'client' ? 'user' : 'package'} size={18} />
                </span>
                <span className="xw-notif-text">
                  <span className="xw-notif-title">{row.title}</span>
                  {row.subtitle ? <span className="xw-notif-detail">{row.subtitle}</span> : null}
                </span>
              </a>
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="xw-search" ref={root} role="search">
      <span className="xw-search-ic" aria-hidden="true">
        <Ico name="search" size={18} />
      </span>
      <input
        ref={input}
        type="search"
        className="xw-search-input"
        role="combobox"
        aria-label={t('hdr_search_label')}
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && rows[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={t('hdr_search_placeholder')}
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {onClose ? (
        <button type="button" className="xw-icon-btn xw-search-close" style={{ marginRight: 0 }} aria-label={t('hdr_search_close')} onClick={onClose}>
          <Ico name="x" size={20} />
        </button>
      ) : null}
      {expanded ? (
        <div className="xw-pop-panel xw-search-panel">
          <p className="xw-search-status" role="status" aria-live="polite">
            {summary}
          </p>
          {rows.length > 0 ? (
            <div id={listId} role="listbox" aria-label={t('hdr_search_label')}>
              {group(t('hdr_search_clients'), clients, 0)}
              {group(t('hdr_search_items'), items, clients.length)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
