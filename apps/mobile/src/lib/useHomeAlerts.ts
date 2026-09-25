import { useEffect, useMemo } from 'react';
import { actorOf, meets } from './access';
import { buildAlerts, dismissAlert, markAllRead, markRead, markSeen, pendingAlerts, visibleAlerts, type HomeAlert } from './alerts';
import { updateAlertState, useAlertState } from './alertStore';
import { useCashToday, useItems, useSubscription } from './queries';
import { useAuthed } from './session';

/**
 * Alertas del Inicio, la campana y Notificaciones: se calculan con las consultas que la app YA hace (inventario, caja del
 * día, suscripción) y solo las que esta persona puede ver. `pending` es lo que cuenta la insignia de la campana y la
 * tarjeta "Alertas": siempre coinciden porque salen de este mismo cálculo.
 */
export function useHomeAlerts() {
  const { user, business } = useAuthed();
  const actor = actorOf(user);
  const isOwner = user.role === 'owner';
  const canCatalog = meets(actor, ['catalog_view']);
  const items = useItems(canCatalog);
  const cash = useCashToday(isOwner);
  const subscription = useSubscription();
  const { state, loaded } = useAlertState(business.id);

  const alerts = useMemo(
    () => buildAlerts({ isOwner, canCatalog, items: items.data, cashOpened: cash.data ? Boolean(cash.data.opening) : undefined, subscription: subscription.data }),
    [isOwner, canCatalog, items.data, cash.data, subscription.data],
  );

  useEffect(() => {
    if (loaded && alerts.length > 0) updateAlertState((current) => markSeen(current, alerts, Date.now()));
  }, [alerts, loaded]);

  return {
    alerts,
    visible: useMemo(() => visibleAlerts(alerts, state), [alerts, state]),
    pending: useMemo(() => pendingAlerts(alerts, state), [alerts, state]),
    state,
    loading: items.isLoading || cash.isLoading || subscription.isLoading || !loaded,
    read: (alert: HomeAlert) => updateAlertState((current) => markRead(current, alert.signature)),
    readAll: () => updateAlertState((current) => markAllRead(current, alerts)),
    dismiss: (alert: HomeAlert) => updateAlertState((current) => dismissAlert(current, alert.signature)),
  };
}
