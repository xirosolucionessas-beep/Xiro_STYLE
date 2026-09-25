/**
 * Conecta la cabecera y la barra lateral del rediseño con los datos reales (alertas, clientes, inventario, suscripción,
 * sesión y tema). Solo web y solo con sesión iniciada. La presentación vive en HeaderTools.tsx (pura, con props).
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { formatMoney, type Currency } from '@xiro/shared';
import { actorOf, meets } from '@/lib/access';
import { badgeText, relativeTime } from '@/lib/alerts';
import { planCard } from '@/lib/dashboard';
import { isSearchable, searchItems } from '@/lib/search';
import { useClients, useItems, useSubscription } from '@/lib/queries';
import { useAuthed, useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useHomeAlerts } from '@/lib/useHomeAlerts';
import { Ico } from '../icons';
import { useNow } from '../services/useNow';
import { useWebText } from '../services/useWebText';
import { HeaderSearch, MessagesMenu, NotificationsMenu, ProfileMenu, type NotificationRow, type SearchRow } from './HeaderTools';
import type { ShellMode } from './ShellView';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Buscador global: clientes (servidor) y servicios/productos (caché de inventario). Solo lo que esta persona puede ver. */
export function HeaderSearchContainer({ mode }: { mode: ShellMode }) {
  const router = useRouter();
  const { t } = useWebText();
  const { user, business } = useAuthed();
  const actor = actorOf(user);
  const canClients = meets(actor, ['clients_view']);
  const canCatalog = meets(actor, ['catalog_view']);
  const [query, setQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const debounced = useDebounced(query, 250);
  const searchable = isSearchable(query);
  const clients = useClients(debounced.trim(), canClients && isSearchable(debounced));
  const items = useItems(canCatalog);

  const clientRows = useMemo<SearchRow[]>(
    () => (canClients && searchable && clients.data ? clients.data.slice(0, 5).map((c) => ({ id: `c:${c.id}`, title: c.name, subtitle: c.phone ?? c.email ?? undefined, href: `/client/${c.id}`, kind: 'client' as const })) : []),
    [canClients, searchable, clients.data],
  );
  const itemRows = useMemo<SearchRow[]>(
    () => (canCatalog && searchable && items.data ? searchItems(items.data, query).map((i) => ({ id: `i:${i.id}`, title: i.name, subtitle: `${i.categoryName} · ${formatMoney(i.price, business.currency as Currency)}`, href: `/item/${i.id}`, kind: 'item' as const })) : []),
    [canCatalog, searchable, items.data, query, business.currency],
  );

  if (!canClients && !canCatalog) return null;

  const search = (
    <HeaderSearch
      t={t}
      query={query}
      onQueryChange={setQuery}
      searchable={searchable}
      loading={clients.isFetching || items.isLoading}
      clients={clientRows}
      items={itemRows}
      onOpenRow={(row) => router.push(row.href as never)}
      onClose={mode === 'mobile' ? () => setMobileOpen(false) : undefined}
    />
  );

  if (mode !== 'mobile') return search;
  return mobileOpen ? (
    <div className="xw-search-overlay">{search}</div>
  ) : (
    <button type="button" className="xw-tool" aria-label={t('hdr_search_open')} onClick={() => setMobileOpen(true)}>
      <Ico name="search" size={22} />
    </button>
  );
}

/** Campanita (mismas alertas que la pantalla Notificaciones y la tarjeta de alertas), mensajes y menú de perfil. */
export function HeaderToolsContainer({ mode }: { mode: ShellMode }) {
  const router = useRouter();
  const { t, language } = useWebText();
  const { user } = useAuthed();
  const { signOut } = useSession();
  const { theme, setTheme } = useSettings();
  const { visible, pending, loading, state, read, readAll } = useHomeAlerts();
  const now = useNow();

  const rows = useMemo<NotificationRow[]>(
    () =>
      visible.map((alert) => ({
        id: alert.signature,
        title: t(alert.titleKey),
        detail: alert.detailKey ? t(alert.detailKey, alert.detailParams) : undefined,
        time: state.seen[alert.signature] ? relativeTime(state.seen[alert.signature]!, now, language) : undefined,
        priority: alert.priority,
        unread: pending.some((p) => p.signature === alert.signature),
        href: alert.href,
      })),
    [visible, pending, state.seen, t, language, now],
  );

  return (
    <>
      <NotificationsMenu
        t={t}
        rows={rows}
        pending={pending.length}
        badge={badgeText(pending.length)}
        loading={loading}
        onOpenRow={(row) => {
          const alert = visible.find((a) => a.signature === row.id);
          if (alert) read(alert);
          router.navigate(row.href as never);
        }}
        onReadAll={readAll}
        onViewAll={() => router.push('/notifications')}
      />
      <MessagesMenu t={t} />
      <ProfileMenu
        t={t}
        name={user.name}
        roleLabel={user.role === 'owner' ? t('role_owner') : t('role_employee')}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onProfile={() => router.push('/profile')}
        onLogout={() => void signOut()}
        compact={mode === 'mobile'}
      />
    </>
  );
}

/** Tarjeta del plan al pie de la barra lateral: estado real de la suscripción (solo el dueño la gestiona). */
export function SidebarPlan({ navigate }: { navigate: (href: string) => void }) {
  const { t, language } = useWebText();
  const { user } = useAuthed();
  const subscription = useSubscription();
  const card = user.role === 'owner' ? planCard(subscription.data) : null;
  if (!card) return null;
  const date = card.date ? new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(card.date)) : '';
  const text = card.kind === 'trial' ? t('side_plan_trial', { date }) : card.kind === 'active' ? t('side_plan_active', { date }) : card.kind === 'grace' ? t('side_plan_grace') : t('side_plan_blocked');
  return (
    <div className={`xw-plan is-${card.kind}`}>
      <span className="xw-plan-ic" aria-hidden="true">
        <Ico name="crown" size={20} />
      </span>
      <p className="xw-plan-title">{t('side_plan_title')}</p>
      <p className="xw-plan-text">{text}</p>
      <a
        className="xw-plan-cta"
        href="/subscription"
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          navigate('/subscription');
        }}>
        {t('side_plan_cta')}
      </a>
    </div>
  );
}
