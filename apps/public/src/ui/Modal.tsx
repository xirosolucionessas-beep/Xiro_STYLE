import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

const FOCUSABLE = ['a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'].join(',');

export interface ModalProps {
  title: string;
  /** Texto accesible del botón de cerrar (la pasa quien llama, ya traducido — este componente no depende de @xiro/shared). */
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 'lg': diálogo ancho (~960px) de dos columnas en escritorio. 'full': vista inmersiva a pantalla completa (detalle de un
   * servicio o producto, siempre en tema oscuro). Por defecto, el formulario angosto de siempre. */
  size?: 'md' | 'lg' | 'full';
  /** El título sigue anunciándose (aria-labelledby) pero no se dibuja — para cuando el nombre ya aparece en el contenido. */
  hideTitle?: boolean;
}

/** Diálogo accesible mínimo: foco atrapado, Escape cierra, devuelve el foco a quien lo abrió, bloquea el scroll,
 * y el botón "atrás" del navegador lo cierra en vez de salir de la página (sin perder la posición del scroll de
 * la lista de atrás: no es una navegación real, solo un estado de historial que se consume al cerrar). */
export function Modal({ title, closeLabel, onClose, children, footer, size = 'md', hideTitle = false }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // Empuja el estado de historial una sola vez por apertura real (un ref sobrevive al montar-desmontar-montar
  // sincrónico con el que React, en modo estricto de desarrollo, prueba que los efectos resisten un remontaje).
  const pushedRef = useRef(false);
  const aliveRef = useRef(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    aliveRef.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusable()[0] ?? container).focus();

    // Un estado de historial propio: si lo quitan con "atrás", se cierra; si se cierra de otra forma, se consume
    // (pop) para no dejar un "adelante" fantasma que reabra el modal.
    if (!pushedRef.current) {
      history.pushState({ xpModal: true }, '');
      pushedRef.current = true;
    }
    let consumedByPopstate = false;
    const onPopState = () => {
      consumedByPopstate = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPopState);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // En captura: el modal atiende Esc ANTES que quien lo contiene (el flujo de reserva también cierra con Esc) y lo detiene ahí.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      aliveRef.current = false;
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('popstate', onPopState);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
      // `history.back()` es asíncrono: su `popstate` puede llegar después de un remontaje (el doble montaje de
      // modo estricto). Por eso se difiere y, si para entonces este efecto ya volvió a estar activo, no era un
      // cierre real — no se toca el historial, y el remontaje sigue dueño de la entrada que ya empujó.
      setTimeout(() => {
        if (!aliveRef.current && !consumedByPopstate && pushedRef.current && history.state?.xpModal) {
          pushedRef.current = false;
          history.back();
        }
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`xp-modal-backdrop${size === 'full' ? ' xp-modal-backdrop--full' : ''}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`xp-modal${size === 'lg' ? ' xp-modal--lg' : size === 'full' ? ' xp-modal--full' : ''}`}>
        <button type="button" className="xp-modal-close xp-icon-btn" aria-label={closeLabel} onClick={onClose}>
          <Icon name="close" size={size === 'full' ? 22 : 20} />
        </button>
        <h2 id={titleId} className={hideTitle ? 'xp-sr' : undefined}>
          {title}
        </h2>
        <div className="xp-stack">{children}</div>
        {footer ? <div className="xp-btn-row xp-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
