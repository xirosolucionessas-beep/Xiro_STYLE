import { translate, type Language } from '@xiro/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';

/**
 * Galería en cuadrícula responsive. Al tocar una foto se abre en grande (teclado: Esc cierra, flechas navegan; al cerrar el foco
 * vuelve a la foto que se tocó). Las fotos son de tamaño fijo con recorte (object-fit), nunca estiradas.
 */
export function GallerySection({ photos, language }: { photos: string[]; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open === null) return;
    const total = photos.length;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // la página de atrás no se desplaza mientras se ve la foto
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
      else if (event.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % total));
      else if (event.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + total) % total));
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener.current?.focus();
    };
  }, [open === null, photos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (photos.length === 0) return null;
  const total = photos.length;
  const step = (delta: number) => setOpen((i) => (i === null ? i : (i + delta + total) % total));

  return (
    <section className="xp-section" id="galeria" aria-labelledby="xp-gallery-h">
      <h2 id="xp-gallery-h">{t('pub_nav_gallery')}</h2>
      <ul className="xp-gallery-grid">
        {photos.map((url, index) => (
          <li key={url}>
            <button
              type="button"
              className="xp-gallery-btn"
              aria-label={t('pub_gallery_open', { n: index + 1, total })}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen(index);
              }}>
              <img src={url} alt="" width={400} height={400} loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>

      {open !== null ? (
        <div className="xp-lightbox" role="dialog" aria-modal="true" aria-label={t('pub_gallery_count', { n: open + 1, total })}>
          <button type="button" ref={closeButton} className="xp-lightbox-close" aria-label={t('pub_gallery_close')} onClick={() => setOpen(null)}>
            <Icon name="close" size={24} />
          </button>
          <img className="xp-lightbox-img" src={photos[open]} alt="" />
          {total > 1 ? (
            <>
              <button type="button" className="xp-lightbox-nav xp-lightbox-prev" aria-label={t('pub_gallery_prev')} onClick={() => step(-1)}>
                <Icon name="back" size={26} />
              </button>
              <button type="button" className="xp-lightbox-nav xp-lightbox-next" aria-label={t('pub_gallery_next')} onClick={() => step(1)}>
                <Icon name="next" size={26} />
              </button>
              <p className="xp-lightbox-count" aria-hidden="true">
                {t('pub_gallery_count', { n: open + 1, total })}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
