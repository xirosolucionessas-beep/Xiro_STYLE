import { useEffect, useState, type RefObject } from 'react';

/** ¿Se ve el elemento en pantalla? Sin IntersectionObserver (navegadores muy viejos) se asume que sí, para no ocultar nada de más. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? true), { threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}
