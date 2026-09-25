import { Ico, type IconName } from '../icons';
import { Button } from '../ui';
import { EmptyPanel, LoadingRows, Panel } from '../ui/Page';
import { cx, useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface NotificationItem {
  id: string;
  title: string;
  detail?: string;
  /** "hace 10 min". */
  time: string;
  priority: 'urgent' | 'warning' | 'info';
}

export interface NotificationsViewProps {
  t: T;
  loading: boolean;
  unread: NotificationItem[];
  done: NotificationItem[];
  /** El navegador bloqueó las notificaciones: solo se avisa (reactivarlas es desde los permisos del sitio). */
  permissionOff: boolean;
  onOpen: (id: string) => void;
  onDismiss: (id: string) => void;
  onReadAll: () => void;
  /** Solo el dueño gestiona las notificaciones del negocio. */
  onSettings?: () => void;
}

const ICON: Record<NotificationItem['priority'], IconName> = { urgent: 'triangle-alert', warning: 'triangle-alert', info: 'info' };

function Row({ item, read, t, onOpen, onDismiss }: { item: NotificationItem; read: boolean; t: T; onOpen: (id: string) => void; onDismiss: (id: string) => void }) {
  return (
    <li className={cx('xw-nrow', read && 'is-read')}>
      <button type="button" className="xw-nrow-main" onClick={() => onOpen(item.id)}>
        <span className={cx('xw-nrow-ic', `is-${item.priority}`)} aria-hidden="true">
          <Ico name={ICON[item.priority]} size={20} />
        </span>
        <span className="xw-notif-text">
          <span className="xw-notif-title">{item.title}</span>
          {item.detail ? <span className="xw-notif-detail">{item.detail}</span> : null}
          <span className="xw-notif-time">{item.time}</span>
        </span>
      </button>
      <button type="button" className="xw-icon-btn" style={{ marginRight: 0 }} aria-label={`${t('notif_dismiss')}: ${item.title}`} onClick={() => onDismiss(item.id)}>
        <Ico name="x" size={18} />
      </button>
    </li>
  );
}

/** Centro de notificaciones: pendientes y leídas, con las mismas alertas que la campana. Solo datos reales; sin alertas, estado vacío. */
export function NotificationsView({ t, loading, unread, done, permissionOff, onOpen, onDismiss, onReadAll, onSettings }: NotificationsViewProps) {
  useWebStyles();
  const empty = !loading && unread.length === 0 && done.length === 0;
  return (
    <div className="xw-section">
      {permissionOff ? (
        <p className="xw-note" role="status">
          <Ico name="info" size={18} />
          <span>{t('notif_permission_off')}</span>
        </p>
      ) : null}

      <div className="xw-toolbar">
        {unread.length > 0 ? (
          <Button variant="secondary" icon={<Ico name="check" size={18} />} onPress={onReadAll}>
            {t('notif_mark_all')}
          </Button>
        ) : null}
        {onSettings ? (
          <Button variant="ghost" icon={<Ico name="sliders" size={18} />} onPress={onSettings}>
            {t('notif_settings')}
          </Button>
        ) : null}
      </div>

      {loading ? <LoadingRows label={t('dash_loading')} /> : null}
      {empty ? <EmptyPanel icon="bell" title={t('notif_empty')} /> : null}

      {unread.length > 0 ? (
        <Panel title={t('hdr_notifications')} icon="bell">
          <ul className="xw-nlist">
            {unread.map((item) => (
              <Row key={item.id} item={item} read={false} t={t} onOpen={onOpen} onDismiss={onDismiss} />
            ))}
          </ul>
        </Panel>
      ) : null}

      {done.length > 0 ? (
        <Panel title={t('notif_read_section')} icon="check">
          <ul className="xw-nlist">
            {done.map((item) => (
              <Row key={item.id} item={item} read t={t} onOpen={onOpen} onDismiss={onDismiss} />
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
