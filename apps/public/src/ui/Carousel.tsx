import { translate, type Language } from '@xiro/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * Carrusel del detalle a pantalla completa: cada foto completa y en grande (sin recortes), se desliza con el dedo
 * (scroll-snap nativo, fluido en cualquier teléfono), con flechas en escritorio, flechas del teclado, miniaturas y
 * contador "2 de 5". Sin fotos: un ícono neutro, nunca un hueco vacío.
 */
export function Carousel({ images, alt, language }: { images: string[]; alt: string; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const total = images.length;
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const go = useCallback(
    (next: number) => {
      const target = (next + total) % total;
      setIndex(target);
      const el = track.current;
      el?.scrollTo?.({ left: target * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    },
    [total, reduced],
  );

  // Al deslizar con el dedo, el contador y las miniaturas siguen a la foto visible.
  const onScroll = () => {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    const visible = Math.round(el.scrollLeft / el.clientWidth);
    if (visible !== index && visible >= 0 && visible < total) setIndex(visible);
  };

  useEffect(() => {
    if (total < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') go(index + 1);
      else if (event.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total, index, go]);

  if (total === 0) {
    return (
      <div className="xp-carousel xp-carousel--empty" aria-hidden="true">
        <Icon name="image" size={48} />
      </div>
    );
  }

  return (
    <div className="xp-carousel" role="region" aria-roledescription="carousel" aria-label={alt}>
      <div className="xp-carousel-track" ref={track} onScroll={onScroll} tabIndex={-1}>
        {images.map((src, i) => (
          <div key={src} className="xp-carousel-slide" role="group" aria-roledescription="slide" aria-label={t('pub_gallery_count', { n: i + 1, total })} aria-hidden={i !== index}>
            <img src={src} alt={i === 0 ? alt : ''} decoding="async" loading={i === 0 ? 'eager' : 'lazy'} />
          </div>
        ))}
      </div>
      {total > 1 ? (
        <>
          <button type="button" className="xp-carousel-nav xp-carousel-prev" aria-label={t('pub_gallery_prev')} onClick={() => go(index - 1)}>
            <Icon name="back" size={22} />
          </button>
          <button type="button" className="xp-carousel-nav xp-carousel-next" aria-label={t('pub_gallery_next')} onClick={() => go(index + 1)}>
            <Icon name="next" size={22} />
          </button>
          <span className="xp-carousel-count" aria-live="polite">
            {t('pub_gallery_count', { n: index + 1, total })}
          </span>
          <div className="xp-carousel-thumbs" role="tablist" aria-label={alt}>
            {images.map((src, i) => (
              <button key={src} type="button" role="tab" aria-selected={i === index} aria-label={t('pub_gallery_count', { n: i + 1, total })} className="xp-carousel-thumb" onClick={() => go(i)}>
                <img src={src} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
