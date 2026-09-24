import { useEffect, type RefObject } from 'react';
import { focusableIn } from '../ui/useDialogBehavior';

const MARK = 'data-xw-inert';

/**
 * Las pantallas inactivas de la navegación (pestañas ya visitadas) quedan montadas detrás con aria-hidden="true",
 * pero sus controles siguen siendo alcanzables con Tab. Aquí se marcan como `inert` mientras estén ocultas
 * (aria-hidden + controles enfocables) y se liberan cuando vuelven a mostrarse.
 */
export function syncInert(root: HTMLElement): void {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[aria-hidden="true"]'))) {
    if (node.hasAttribute(MARK)) continue;
    if (focusableIn(node).length > 0) {
      node.setAttribute('inert', '');
      node.setAttribute(MARK, '');
    }
  }
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(`[${MARK}]`))) {
    if (node.getAttribute('aria-hidden') !== 'true') {
      node.removeAttribute('inert');
      node.removeAttribute(MARK);
    }
  }
}

export function useInertHidden(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncInert(root));
    };
    syncInert(root);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-hidden'] });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rootRef]);
}
