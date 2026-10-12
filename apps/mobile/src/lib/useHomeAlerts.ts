import { useEffect, useMemo } from 'react';
import { actorOf, meets } from './access';
import { buildAlerts, dismissAlert, markAllRead, markRead, markSeen, pendingAlerts, serverNotificationAlert, visibleAlerts, type HomeAlert } from './alerts';
import { updateAlertState, useAlertState } from './alertStore';
import { useCashToday, useItemsSummary, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useSubscription } from './queries';
import { useAuthed } from './session';

/**
 * Alertas del Inicio, la campana y Notificaciones: las 3 calculadas con datos que la app YA consulta (inventario, caja
 * del día, suscripción) MÁS los avisos reales guardados en el backend (citas, reseñas, fidelización, facturación —
 * ver push.ts), unidos en una sola lista. `pending` es lo que cuenta la insignia de la campana y la tarjeta
 * "Alertas": siempre coinciden porque salen de este mismo cálculo.
 */
export function useHomeAlerts() {
  const { user, business } = useAuthed();
  const actor = actorOf(user);
  const isOwner = user.role === 'owner';
  const canCatalog = meets(actor, ['catalog_view']);
  const items = useItemsSummary(canCatalog);
  const cash = useCashToday(isOwner);
  const subscription = useSubscription();
  const notifications = useNotifications();
  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();
  const { state, loaded } = useAlertState(business.id);

  const localAlerts = useMemo(
    () => buildAlerts({ isOwner, canCatalog, stock: items.data?.stock, cashOpened: cash.data ? Boolean(cash.data.opening) : undefined, subscription: subscription.data }),
    [isOwner, canCatalog, items.data, cash.data, subscription.data],
  );
  const serverAlerts = useMemo(() => (notifications.data?.notifications ?? []).map(serverNotificationAlert), [notifications.data]);
  const alerts = useMemo(() => [...serverAlerts, ...localAlerts], [serverAlerts, localAlerts]);

  useEffect(() => {
    if (loaded && alerts.length > 0) updateAlertState((current) => markSeen(current, alerts, Date.now()));
  }, [alerts, loaded]);

  // Un aviso ya leído en el servidor (p. ej. desde otro dispositivo, o la propia pestaña web) se refleja también aquí:
  // sin esto, "pending"/"visible" (que se calculan con el estado LOCAL) lo mostrarían sin leer otra vez.
  useEffect(() => {
    const readSignatures = (notifications.data?.notifications ?? []).filter((n) => n.read).map((n) => `server:${n.id}`);
    if (readSignatures.length === 0) return;
    updateAlertState((current) => readSignatures.reduce((next, signature) => markRead(next, signature), current));
  }, [notifications.data]);

  return {
    alerts,
    visible: useMemo(() => visibleAlerts(alerts, state), [alerts, state]),
    pending: useMemo(() => pendingAlerts(alerts, state), [alerts, state]),
    state,
    loading: items.isLoading || cash.isLoading || subscription.isLoading || !loaded,
    read: (alert: HomeAlert) => {
      updateAlertState((current) => markRead(current, alert.signature));
      if (alert.serverId) markReadMutation.mutate(alert.serverId);
    },
    readAll: () => {
      updateAlertState((current) => markAllRead(current, alerts));
      if (serverAlerts.length > 0) markAllReadMutation.mutate();
    },
    dismiss: (alert: HomeAlert) => updateAlertState((current) => dismissAlert(current, alert.signature)),
  };
}
