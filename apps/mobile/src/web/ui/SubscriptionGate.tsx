/**
 * Aviso de vencimiento/vencida de la suscripción (sección 4), versión Web. Misma regla que la nativa
 * (subscriptionNotice, en @xiro/shared): bloqueante SOLO sin acceso real; en gracia o "por vencer" es descartable.
 */
import { subscriptionNotice, type Subscription } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSubscription } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { localDateKey } from '@/web/date';
import { Ico } from '../icons';
import { Button } from './Button';
import { useWebStyles } from './shared';
import { useDialogBehavior } from './useDialogBehavior';

type T = (key: string, params?: Record<string, string | number>) => string;

function noticeKey(subscription: Subscription): string | null {
  const notice = subscriptionNotice(subscription);
  return notice ? `${notice}:${subscription.trialEndsAt}:${subscription.currentPeriodEnd}:${subscription.gracePeriodEndsAt}` : null;
}

// Un cierre (botón X, clic fuera o "Ver planes más tarde") ya no debe volver a abrir el MISMO aviso el resto del día:
// antes `dismissed` vivía solo en memoria, así que cualquier recarga de la página lo mostraba de nuevo. Se guarda
// "aviso|día" en localStorage, por usuario (varias cuentas en el mismo navegador no se pisan la una a la otra). Si al
// día siguiente el problema sigue sin resolverse, vuelve a avisar una vez — no se silencia para siempre.
function dismissKeyFor(userId: string): string {
  return `xiro.subGate.dismissed.${userId}`;
}
function readDismissed(userId: string): string | null {
  try {
    const raw = localStorage.getItem(dismissKeyFor(userId));
    if (!raw) return null;
    const [key, day] = raw.split('|');
    return day === localDateKey() ? (key ?? null) : null;
  } catch {
    return null;
  }
}
function writeDismissed(userId: string, key: string): void {
  try {
    localStorage.setItem(dismissKeyFor(userId), `${key}|${localDateKey()}`);
  } catch {
    /* almacenamiento bloqueado: se volverá a preguntar en esta sesión, no es grave */
  }
}

export function SubscriptionGate({ t, language }: { t: T; language: string }) {
  useWebStyles();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { status: sessionStatus, signOut, user } = useSession();
  // Un empleado no puede renovar ni ver planes: solo se le avisa cuando ya no hay acceso, y se le dice a quién acudir.
  const isEmployee = user?.role === 'employee';
  const { data: subscription } = useSubscription(sessionStatus === 'signedIn');
  const [dismissed, setDismissed] = useState<string | null>(() => (user ? readDismissed(user.id) : null));

  const notice = subscription ? subscriptionNotice(subscription) : null;
  const key = subscription ? noticeKey(subscription) : null;
  const open = sessionStatus === 'signedIn' && Boolean(subscription) && Boolean(notice) && key !== dismissed && (!isEmployee || notice === 'blocked');
  const blocking = notice === 'blocked';

  const dismiss = () => {
    if (!key) return;
    setDismissed(key);
    if (user) writeDismissed(user.id, key);
  };
  useDialogBehavior(open, dialogRef, blocking ? () => undefined : dismiss);

  if (!open || !subscription || typeof document === 'undefined') return null;

  const dueDateRaw = notice === 'grace' ? subscription.gracePeriodEndsAt : subscription.status === 'trial' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  const dateLabel = dueDateRaw ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'long' }).format(new Date(dueDateRaw)) : '';
  const titleKey = blocking ? 'subscription_expired_title' : notice === 'grace' ? 'subscription_grace_title' : 'subscription_expiring_title';
  const bodyKey = isEmployee ? 'subscription_employee_blocked_body' : blocking ? 'subscription_expired_body' : notice === 'grace' ? 'subscription_grace_body' : 'subscription_expiring_body';

  const goToPlans = (preselectCurrent: boolean) => {
    dismiss();
    router.push(preselectCurrent && subscription.plan ? `/subscription?plan=${subscription.plan}` : '/subscription');
  };
  const logout = () => {
    if (window.confirm(t('logout_sub'))) void signOut();
  };

  return createPortal(
    <div role="presentation" data-xw-portal="" className="xw-subgate-root">
      <div role="presentation" className="xw-subgate-scrim" onMouseDown={(event) => !blocking && event.target === event.currentTarget && dismiss()} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="xw-subgate">
        {!blocking ? (
          <button type="button" className="xw-subgate-close" aria-label={t('close')} onClick={dismiss}>
            <Ico name="x" size={18} />
          </button>
        ) : null}
        <div className="xw-subgate-icon">
          <Ico name="calendar-days" size={30} />
          <span className="xw-subgate-icon-badge">
            <Ico name="clock" size={13} />
          </span>
        </div>
        <h2 id={titleId} className="xw-subgate-title">
          {t(titleKey)}
        </h2>
        <p className="xw-subgate-body">{t(bodyKey, { date: dateLabel })}</p>
        {isEmployee ? null : (
          <>
            <Button fullWidth onPress={() => goToPlans(true)}>
              {t('renew_now')}
            </Button>
            <Button fullWidth variant="secondary" onPress={() => goToPlans(false)}>
              {t('view_plans')}
            </Button>
          </>
        )}
        {blocking ? (
          <button type="button" className="xw-subgate-logout" onClick={logout}>
            {t('logout')}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
