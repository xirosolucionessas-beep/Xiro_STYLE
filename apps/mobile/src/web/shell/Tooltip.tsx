import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Tooltip visual para ítems que solo muestran icono (WCAG 1.4.13): aparece con hover o foco de teclado,
 * se puede cerrar con Escape sin mover el foco y permanece visible mientras el puntero está sobre él.
 * El nombre accesible del control ya es su etiqueta (texto solo para lectores), por eso el tooltip es aria-hidden
 * y no duplica el anuncio.
 */
export function Tooltip({ label, enabled = true, children }: { label: string; enabled?: boolean; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const show = () => setVisible(true);
    const hide = () => setVisible(false);
    element.addEventListener('mouseenter', show);
    element.addEventListener('mouseleave', hide);
    element.addEventListener('focusin', show);
    element.addEventListener('focusout', hide);
    return () => {
      element.removeEventListener('mouseenter', show);
      element.removeEventListener('mouseleave', hide);
      element.removeEventListener('focusin', show);
      element.removeEventListener('focusout', hide);
    };
  }, []);

  // Escape descarta el tooltip aunque solo esté el puntero encima (sin foco en el control).
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVisible(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  return (
    <span ref={wrap} className="xw-tipwrap">
      {children}
      {enabled && visible ? (
        <span className="xw-tip" aria-hidden="true">
          {label}
        </span>
      ) : null}
    </span>
  );
}
