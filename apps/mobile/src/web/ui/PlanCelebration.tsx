/**
 * "¡Bienvenido a Xiro Premium!" (Tarea 9): corona dorada con destello + confeti sutil, una sola vez, SOLO cuando el
 * plan de pago ya está activo de verdad (nunca al tocar un botón de compra). Ver PlanCelebrationHost para cuándo se
 * decide mostrarla.
 *
 * Los dos botones de comprobante (factura de suscripción) son OPCIONALES a propósito: nunca se dispara una
 * descarga sola, solo al tocarlos — ver el prompt de facturación de suscripción. `onDownloadInvoice`/`onViewPosTicket`
 * ausentes (todavía no hay comprobante que mostrar, p. ej. datos aún cargando) ⇒ esos botones no se muestran.
 */
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Ico } from '../icons';
import { Button } from './Button';
import { useWebStyles } from './shared';
import { useDialogBehavior } from './useDialogBehavior';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface PlanCelebrationProps {
  open: boolean;
  onClose: () => void;
  t: T;
  /** "Mensual" o "Anual", ya traducido. */
  planLabel: string;
  /** Fecha de renovación, ya formateada ("30 de octubre"); "" si no se conoce. */
  renewalDate: string;
  onDownloadInvoice?: () => void;
  onViewPosTicket?: () => void;
}

const CONFETTI = Array.from({ length: 10 }, (_, i) => ({ left: `${8 + i * 9}%`, delay: `${(i % 5) * 0.15}s`, drift: i % 2 === 0 ? '18px' : '-14px' }));

export function PlanCelebration({ open, onClose, t, planLabel, renewalDate, onDownloadInvoice, onViewPosTicket }: PlanCelebrationProps) {
  useWebStyles();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, dialogRef, onClose);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div role="presentation" data-xw-portal="" className="xw-celebrate-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="xw-celebrate-card">
        <div className="xw-celebrate-confetti" aria-hidden="true">
          {CONFETTI.map((dot, i) => (
            <span key={i} className="xw-celebrate-dot" style={{ left: dot.left, animationDelay: dot.delay, ['--xw-drift' as string]: dot.drift }} />
          ))}
        </div>
        <span className="xw-celebrate-crown" aria-hidden="true">
          <Ico name="crown" size={38} />
        </span>
        <h2 id={titleId} className="xw-celebrate-title">
          {t('plan_celebrate_title')}
        </h2>
        <p className="xw-celebrate-body">{renewalDate ? t('plan_celebrate_body', { plan: planLabel, date: renewalDate }) : t('plan_celebrate_body_no_date', { plan: planLabel })}</p>
        {onDownloadInvoice || onViewPosTicket ? (
          <div className="xw-celebrate-receipts">
            {onDownloadInvoice ? (
              <Button variant="secondary" size="sm" icon={<Ico name="download" size={16} />} onPress={onDownloadInvoice}>
                {t('plan_celebrate_download_invoice')}
              </Button>
            ) : null}
            {onViewPosTicket ? (
              <Button variant="secondary" size="sm" icon={<Ico name="store" size={16} />} onPress={onViewPosTicket}>
                {t('plan_celebrate_view_pos_ticket')}
              </Button>
            ) : null}
          </div>
        ) : null}
        <Button fullWidth onPress={onClose} style={{ marginTop: 'var(--xw-space-3)' }}>
          {t('plan_celebrate_continue')}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
