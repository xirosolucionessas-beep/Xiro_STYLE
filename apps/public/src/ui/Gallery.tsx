import { translate, type Language } from '@xiro/shared';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Lightbox } from './Lightbox';

/**
 * Galería del detalle de un servicio o producto: imagen principal 4:3, miniaturas debajo (si hay más de una), flechas
 * de teclado en escritorio, contador "2 de 5" y ampliar al tocar la principal. Sin fotos: un ícono neutro, nunca un
 * hueco vacío.
 */
export function Gallery({ images, alt, language }: { images: string[]; alt: string; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const total = images.length;

  useEffect(() => {
    if (total < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') setIndex((i) => (i + 1) % total);
      else if (event.key === 'ArrowLeft') setIndex((i) => (i - 1 + total) % total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  if (total === 0) {
    return (
      <div className="xp-gallery-empty" aria-hidden="true">
        <Icon name="image" size={40} />
      </div>
    );
  }

  return (
    <div className="xp-gallery-detail">
      <button type="button" className="xp-gallery-main" onClick={() => setZoomed(true)} aria-label={t('pub_gallery_open', { n: index + 1, total })}>
        <img src={images[index]} alt={alt} width={640} height={480} decoding="async" />
        {total > 1 ? (
          <span className="xp-gallery-count" aria-hidden="true">
            {t('pub_gallery_count', { n: index + 1, total })}
          </span>
        ) : null}
      </button>
      {total > 1 ? (
        <div className="xp-gallery-thumbs" role="tablist" aria-label={alt}>
          {images.map((src, i) => (
            <button key={src} type="button" role="tab" aria-selected={i === index} className="xp-gallery-thumb" onClick={() => setIndex(i)}>
              <img src={src} alt="" width={96} height={96} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      ) : null}

      {zoomed ? <Lightbox photos={images} index={index} onChange={setIndex} onClose={() => setZoomed(false)} language={language} /> : null}
    </div>
  );
}
