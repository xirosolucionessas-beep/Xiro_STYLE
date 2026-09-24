import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = ['a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'].join(',');

export const focusableIn = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('aria-hidden'));

/**
 * Comportamiento común de diálogos y drawers:
 * foco atrapado, cierre con Escape, retorno del foco a quien lo abrió, bloqueo de scroll
 * y aria-hidden en el resto de la página. El elemento portal debe llevar `data-xw-portal`.
 */
export function useDialogBehavior(open: boolean, containerRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const portal = container?.closest('[data-xw-portal]') ?? container?.parentElement;
    if (!container || !portal) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const hidden: Array<[Element, string | null]> = [];
    for (const sibling of Array.from(document.body.children)) {
      if (sibling === portal || sibling.tagName === 'SCRIPT') continue;
      hidden.push([sibling, sibling.getAttribute('aria-hidden')]);
      sibling.setAttribute('aria-hidden', 'true');
    }

    // Listener nativo: el contenedor no es un elemento interactivo.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(container);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKeyDown);

    (focusableIn(container)[0] ?? container).focus();

    return () => {
      container.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const [element, previous] of hidden) {
        if (previous === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', previous);
      }
      opener?.focus();
    };
  }, [open, containerRef]);
}
