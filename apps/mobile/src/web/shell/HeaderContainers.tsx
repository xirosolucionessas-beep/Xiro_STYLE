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
import { useClientSearch, useConversations, useItemsQuery, useSubscription, useSubscriptionInvoices } from '@/lib/queries';
import { useAuthed, useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useHomeAlerts } from '@/lib/useHomeAlerts';
import { Ico } from '../icons';
import { useNow } from '../services/useNow';
import { useWebText } from '../services/useWebText';
import { downloadSubscriptionInvoicePdf, downloadSubscriptionPosTicketPdf } from '../services/subscriptionInvoicePdf';
import { PlanCelebration } from '../ui/PlanCelebration';
import { HeaderSearch, MessagesMenu, NotificationsMenu, ProfileMenu, type MessageRow, type NotificationRow, type SearchRow } from './HeaderTools';
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
  // Búsqueda global en el servidor: 5 clientes y hasta 20 artículos candidatos (luego se ordenan por relevancia).
  const clientSearch = useClientSearch(debounced.trim(), canClients && isSearchable(debounced), 5);
  const clients = { data: clientSearch.data?.data, isFetching: clientSearch.isFetching };
  const itemSearch = useItemsQuery({ q: debounced.trim() || undefined, limit: 20 }, canCatalog && isSearchable(debounced));
  const items = { data: itemSearch.data?.data, isLoading: itemSearch.isLoading };

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
  const conversations = useConversations();

  const messageRows = useMemo<MessageRow[]>(
    () =>
      (conversations.data ?? []).map((c) => ({
        id: c.id,
        peerName: c.peer.name,
        peerPhotoUrl: c.peer.photoUrl,
        preview: c.lastMessage ? (c.lastMessage.senderId === user.id ? t('msg_you_prefix', { text: c.lastMessage.content }) : c.lastMessage.content) : '',
        time: relativeTime(Date.parse(c.updatedAt), now, language),
        unread: c.unreadCount > 0,
      })),
    [conversations.data, user.id, t, language, now],
  );
  const unreadConversations = (conversations.data ?? []).filter((c) => c.unreadCount > 0).length;

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
      <MessagesMenu
        t={t}
        rows={messageRows}
        unreadCount={unreadConversations}
        badge={badgeText(unreadConversations)}
        loading={conversations.isLoading}
        onOpenRow={(id) => router.push({ pathname: '/messages', params: { c: id } } as never)}
        onViewAll={() => router.push('/messages')}
      />
      <ProfileMenu
        t={t}
        name={user.name}
        photoUrl={user.photoUrl}
        roleLabel={user.role === 'owner' ? t('role_owner') : t('role_employee')}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onProfile={() => router.push('/profile')}
        onPlan={user.role === 'owner' ? () => router.push('/subscription') : undefined}
        onLogout={() => void signOut()}
        compact={mode === 'mobile'}
      />
    </>
  );
}

/**
 * Tarjeta del plan al pie de la barra lateral: estado real de la suscripción (solo el dueño la gestiona). Con un plan
 * de pago AL DÍA se oculta (el acceso queda discreto en el menú de perfil, ver "Mi plan"): ya no hay nada que avisar.
 * Durante la prueba gratis se mantiene visible todo el tiempo, con los días restantes cerca del final.
 */
export function SidebarPlan({ navigate }: { navigate: (href: string) => void }) {
  const { t, language } = useWebText();
  const { user } = useAuthed();
  const subscription = useSubscription();
  const nowMs = useNow();
  const card = user.role === 'owner' ? planCard(subscription.data) : null;
  if (!card || card.kind === 'active') return null;
  const date = card.date ? new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(card.date)) : '';
  const daysLeft = card.kind === 'trial' && card.date ? Math.ceil((new Date(card.date).getTime() - nowMs) / 86_400_000) : null;
  const trialText = daysLeft !== null && daysLeft <= 3 ? (daysLeft <= 1 ? t('side_plan_trial_last_day') : t('side_plan_trial_days_left', { n: daysLeft })) : t('side_plan_trial', { date });
  const text = card.kind === 'trial' ? trialText : card.kind === 'grace' ? t('side_plan_grace') : t('side_plan_blocked');
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

const subStatusKey = (businessId: string) => `xiro.subStatus.${businessId}`;

/**
 * "¡Bienvenido a Xiro Premium!" (Tarea 9): se dispara SOLO cuando se observa el plan pasar a activo de verdad (nunca
 * al tocar "pagar": la confirmación real puede tardar — redirección de Stripe/PayPal, o una transferencia que un
 * administrador aprueba después, incluso con la persona ya usando otra pantalla). Se guarda el último estado visto
 * por negocio: la PRIMERA vez que se ve un negocio en este navegador solo se registra su estado (no se sabe si ya
 * llevaba tiempo activo), y recién la siguiente vez que se detecta un cambio real a "activo" aparece la animación —
 * una sola vez por activación, nunca en cada renovación automática (es una bienvenida, no un aviso de cada cobro).
 */
export function PlanCelebrationHost({ businessId }: { businessId: string }) {
  const { t, language } = useWebText();
  const { user, business } = useAuthed();
  const subscription = useSubscription();
  // Un empleado no tiene acceso a /subscription/invoices (403): solo el dueño la pide.
  const invoices = useSubscriptionInvoices(user.role === 'owner');
  const [show, setShow] = useState(false);
  const [checkedStatus, setCheckedStatus] = useState<string | null>(null);

  const status = subscription.data?.status;
  if (status && status !== checkedStatus) {
    setCheckedStatus(status);
    const key = subStatusKey(businessId);
    let lastKnown: string | null = null;
    try {
      lastKnown = localStorage.getItem(key);
      localStorage.setItem(key, status);
    } catch {
      /* sin almacenamiento: no se puede saber si es un cambio real, así que no se molesta a nadie */
    }
    if (lastKnown !== null && lastKnown !== 'active' && status === 'active' && subscription.data?.hasAccess) {
      setShow(true);
      void invoices.refetch(); // el comprobante recién emitido todavía no está en la caché con la que se montó este host
    }
  }

  if (!subscription.data) return null;
  const planLabel = subscription.data.plan === 'yearly' ? t('plan_yearly') : t('plan_monthly');
  const renewalDate = subscription.data.currentPeriodEnd ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'long' }).format(new Date(subscription.data.currentPeriodEnd)) : '';

  // El más reciente es el que se acaba de pagar (listSubscriptionInvoices ya viene ordenado por fecha descendente).
  const latestInvoice = invoices.data?.[0];
  const locale = language === 'en' ? 'en-US' : 'es-CO';
  const buildInvoiceInput = () => {
    if (!latestInvoice) return null;
    const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
    const fmtDateTime = (iso: string) => `${fmt(iso)} · ${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))}`;
    return {
      businessName: business.name,
      businessTaxId: business.taxId,
      businessEmail: user.email ?? '',
      businessPhone: business.whatsapp || null,
      paymentId: latestInvoice.id,
      dateLabel: fmtDateTime(latestInvoice.createdAt),
      planLabel: latestInvoice.plan === 'yearly' ? t('plan_yearly') : t('plan_monthly'),
      amount: latestInvoice.amount,
      currency: business.currency,
      paymentMethodLabel: t(`pay_method_${latestInvoice.paymentMethod}`),
      periodStartLabel: fmt(latestInvoice.periodStart),
      periodEndLabel: fmt(latestInvoice.periodEnd),
    };
  };

  return (
    <PlanCelebration
      open={show}
      onClose={() => setShow(false)}
      t={t}
      planLabel={planLabel}
      renewalDate={renewalDate}
      onDownloadInvoice={latestInvoice ? () => downloadSubscriptionInvoicePdf(buildInvoiceInput()!) : undefined}
      onViewPosTicket={latestInvoice ? () => downloadSubscriptionPosTicketPdf(buildInvoiceInput()!) : undefined}
    />
  );
}
