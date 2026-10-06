import { translate, type Language } from '@xiro/shared';
import { useRef, useState } from 'react';
import { Lightbox } from '../ui/Lightbox';

/**
 * Galería en cuadrícula responsive. Al tocar una foto se abre en grande (teclado: Esc cierra, flechas navegan; al cerrar el foco
 * vuelve a la foto que se tocó). Las fotos son de tamaño fijo con recorte (object-fit), nunca estiradas.
 */
export function GallerySection({ photos, language }: { photos: string[]; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  if (photos.length === 0) return null;
  const total = photos.length;
  const close = () => {
    setOpen(null);
    opener.current?.focus();
  };

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

      {open !== null ? <Lightbox photos={photos} index={open} onChange={setOpen} onClose={close} language={language} /> : null}
    </section>
  );
}
