import { translate, type Language } from '@xiro/shared';
import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

/**
 * Foto ampliada a pantalla completa: Esc cierra, flechas navegan entre varias, bloquea el scroll de atrás mientras está
 * abierta. Quien la abre decide a qué elemento vuelve el foco al cerrar (no lo sabe este componente).
 */
export function Lightbox({ photos, index, onChange, onClose, language }: { photos: string[]; index: number; onChange: (next: number) => void; onClose: () => void; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const total = photos.length;
  const closeButton = useRef<HTMLButtonElement>(null);
  // Deslizar con el dedo (más de 50 px en horizontal) pasa a la foto anterior o siguiente.
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Esc cierra SOLO el visor (no el flujo de reserva que lo contiene): se atiende en captura y no sigue.
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      else if (event.key === 'ArrowRight') onChange((index + 1) % total);
      else if (event.key === 'ArrowLeft') onChange((index - 1 + total) % total);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [index, total, onChange, onClose]);

  return (
    <div className="xp-lightbox" role="dialog" aria-modal="true" aria-label={t('pub_gallery_count', { n: index + 1, total })}>
      <button type="button" ref={closeButton} className="xp-lightbox-close" aria-label={t('pub_gallery_close')} onClick={onClose}>
        <Icon name="close" size={24} />
      </button>
      <img
        className="xp-lightbox-img"
        src={photos[index]}
        alt=""
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const start = touchX.current;
          const end = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (start === null || end === undefined || total < 2 || Math.abs(end - start) < 50) return;
          onChange(end < start ? (index + 1) % total : (index - 1 + total) % total);
        }}
      />
      {total > 1 ? (
        <>
          <button type="button" className="xp-lightbox-nav xp-lightbox-prev" aria-label={t('pub_gallery_prev')} onClick={() => onChange((index - 1 + total) % total)}>
            <Icon name="back" size={26} />
          </button>
          <button type="button" className="xp-lightbox-nav xp-lightbox-next" aria-label={t('pub_gallery_next')} onClick={() => onChange((index + 1) % total)}>
            <Icon name="next" size={26} />
          </button>
          <p className="xp-lightbox-count" aria-hidden="true">
            {t('pub_gallery_count', { n: index + 1, total })}
          </p>
        </>
      ) : null}
    </div>
  );
}
