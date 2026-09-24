import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx, Icon, useWebStyles } from './shared';
import { useDialogBehavior } from './useDialogBehavior';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
  closeLabel?: string;
  /** Cierra al hacer clic fuera del cuadro. Por defecto sí. */
  dismissOnBackdrop?: boolean;
  /** 'sheet': hoja inferior a ancho completo (móvil) en vez del cuadro centrado. */
  variant?: 'center' | 'sheet';
}

/**
 * Diálogo modal accesible: role="dialog" + aria-modal, foco atrapado, cierre con Escape,
 * devuelve el foco al elemento que lo abrió, bloquea el scroll e inhabilita (aria-hidden) el resto de la página.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md', closeLabel = 'Cerrar', dismissOnBackdrop = true, variant = 'center' }: ModalProps) {
  useWebStyles();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, dialogRef, onClose);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    // El fondo es solo un atajo de ratón; el teclado cierra con Escape o con el botón de cerrar.
    <div
      role="presentation"
      data-xw-portal=""
      className={cx('xw-backdrop', variant === 'sheet' && 'xw-backdrop--sheet')}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx('xw-modal', size === 'lg' && 'xw-modal--lg', variant === 'sheet' && 'xw-modal--sheet')}>
        <div className="xw-modal-head">
          <h2 className="xw-modal-title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="xw-icon-btn" style={{ marginRight: 0 }} aria-label={closeLabel} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div>{children}</div>
        {footer ? <div className="xw-modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
