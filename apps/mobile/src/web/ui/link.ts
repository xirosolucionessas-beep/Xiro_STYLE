import type { MouseEvent } from 'react';

/** Props de un `<a>` que navega dentro de la app sin recargar, salvo clic con modificador o botón central (abrir en pestaña nueva). */
export function linkProps(href: string, navigate: (href: string) => void) {
  return {
    href,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(href);
    },
  };
}
