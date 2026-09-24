import { useCallback, useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { Ico } from '../icons';
import { cx, useWebStyles } from './shared';
import { useDialogBehavior } from './useDialogBehavior';

type T = (key: string) => string;

export interface GalleryViewerProps {
  /** URLs ya resueltas, como máximo 4 (contrato del catálogo: MAX_PHOTOS_PER_ITEM). */
  photos: string[];
  /** Nombre del artículo/servicio: identifica cada foto para lectores de pantalla. */
  name: string;
  t: T;
}

const swipeDelta = (start: number, end: number) => end - start;

/**
 * Carrusel principal + miniaturas + visor a pantalla completa (sección 7). Un solo `index` gobierna el carrusel
 * (el scroll se sincroniza mediante efecto, no al revés, así flechas, puntos y miniaturas nunca se desincronizan).
 */
export function GalleryViewer({ photos, name, t }: GalleryViewerProps) {
  useWebStyles();
  const total = photos.length;
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);

  useEffect(() => {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    programmatic.current = true;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
    const id = setTimeout(() => {
      programmatic.current = false;
    }, 350);
    return () => clearTimeout(id);
  }, [index]);

  const goTo = (next: number) => setIndex(Math.max(0, Math.min(total - 1, next)));
  const onScroll = () => {
    const el = track.current;
    if (programmatic.current || !el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) setIndex(i);
  };

  if (total === 0) {
    return (
      <div className="xw-gallery-main">
        <div className="xw-gallery-empty">
          <Ico name="image" size={40} />
          <span>{t('gallery_empty')}</span>
        </div>
      </div>
    );
  }

  const photoLabel = (i: number) => `${name} — ${t('gallery_photo')} ${i + 1} ${t('gallery_of')} ${total}`;

  return (
    <div className="xw-gallery">
      <div className="xw-gallery-main">
        <div className="xw-gallery-track" ref={track} onScroll={onScroll}>
          {photos.map((url, i) => (
            <div className="xw-gallery-slide" key={url}>
              <button type="button" aria-label={`${t('gallery_open')}: ${photoLabel(i)}`} onClick={() => setLightbox(i)}>
                <img src={url} alt={photoLabel(i)} />
              </button>
            </div>
          ))}
        </div>

        {total > 1 ? (
          <>
            <button type="button" className="xw-gallery-arrow xw-gallery-arrow--prev" aria-label={t('gallery_prev')} disabled={index === 0} onClick={() => goTo(index - 1)}>
              <Ico name="chevron-left" size={20} />
            </button>
            <button type="button" className="xw-gallery-arrow xw-gallery-arrow--next" aria-label={t('gallery_next')} disabled={index === total - 1} onClick={() => goTo(index + 1)}>
              <Ico name="chevron-right" size={20} />
            </button>
            <div className="xw-gallery-dots">
              {photos.map((url, i) => (
                <button key={url} type="button" className={cx('xw-gallery-dot', i === index && 'is-active')} aria-label={photoLabel(i)} aria-current={i === index} onClick={() => goTo(i)} />
              ))}
            </div>
          </>
        ) : null}
        <span className="xw-gallery-count" aria-hidden="true">
          {index + 1}/{total}
        </span>
      </div>

      {total > 1 ? (
        <>
          <h2 className="xw-thumbs-title">{t('gallery_additional')}</h2>
          <div className="xw-thumbs">
            {photos.map((url, i) => (
              <button key={url} type="button" className={cx('xw-thumb', i === index && 'is-active')} aria-label={photoLabel(i)} aria-current={i === index} onClick={() => goTo(i)}>
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        </>
      ) : null}

      {lightbox !== null ? (
        <Lightbox
          photos={photos}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          label={photoLabel}
          t={t}
        />
      ) : null}
    </div>
  );
}

function Lightbox({ photos, index, onIndex, onClose, label, t }: { photos: string[]; index: number; onIndex: (i: number) => void; onClose: () => void; label: (i: number) => string; t: T }) {
  const panel = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState('center');
  useDialogBehavior(true, panel, onClose);

  const total = photos.length;
  const goTo = useCallback(
    (next: number) => {
      setZoomed(false);
      onIndex(Math.max(0, Math.min(total - 1, next)));
    },
    [total, onIndex],
  );

  // Listener nativo (como useDialogBehavior): el contenedor no es un elemento interactivo, así que las flechas no van por JSX.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && index > 0) goTo(index - 1);
      else if (event.key === 'ArrowRight' && index < total - 1) goTo(index + 1);
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [index, total, goTo]);
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchStart.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (touchStart.current === null) return;
    const delta = swipeDelta(touchStart.current, event.changedTouches[0]?.clientX ?? touchStart.current);
    touchStart.current = null;
    if (delta > 48 && index > 0) goTo(index - 1);
    else if (delta < -48 && index < total - 1) goTo(index + 1);
  };
  const onImageClick = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setOrigin(`${((event.clientX - rect.left) / rect.width) * 100}% ${((event.clientY - rect.top) / rect.height) * 100}%`);
    setZoomed((value) => !value);
  };

  return createPortal(
    <div role="presentation" data-xw-portal="" className="xw-lightbox">
      <div ref={panel} role="dialog" aria-modal="true" aria-label={t('gallery_viewer_label')} tabIndex={-1} className="xw-lightbox-panel">
        <div className="xw-lightbox-top">
          <span className="xw-lightbox-count" aria-hidden="true">
            {index + 1}/{total}
          </span>
          <button type="button" className="xw-lightbox-btn" aria-label={t('close')} onClick={onClose}>
            <Ico name="x" size={20} />
          </button>
        </div>
        {/* El deslizar es un atajo táctil adicional: flechas, zoom y navegación por teclado ya cubren el mismo resultado. */}
        <div className="xw-lightbox-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {total > 1 ? (
            <button type="button" className="xw-lightbox-arrow xw-lightbox-arrow--prev" aria-label={t('gallery_prev')} disabled={index === 0} onClick={() => goTo(index - 1)}>
              <Ico name="chevron-left" size={22} />
            </button>
          ) : null}
          <button
            type="button"
            className="xw-lightbox-img-btn"
            aria-label={`${label(index)} — ${zoomed ? t('gallery_zoom_out') : t('gallery_zoom_in')}`}
            onClick={onImageClick}>
            <img className={cx('xw-lightbox-img', zoomed && 'is-zoomed')} src={photos[index]} alt="" style={{ transform: zoomed ? 'scale(2.2)' : undefined, transformOrigin: origin }} />
          </button>
          {total > 1 ? (
            <button type="button" className="xw-lightbox-arrow xw-lightbox-arrow--next" aria-label={t('gallery_next')} disabled={index === total - 1} onClick={() => goTo(index + 1)}>
              <Ico name="chevron-right" size={22} />
            </button>
          ) : null}
        </div>
        {total > 1 ? (
          <div className="xw-lightbox-bottom">
            {photos.map((url, i) => (
              <button key={url} type="button" className={cx('xw-gallery-dot', i === index && 'is-active')} aria-label={label(i)} aria-current={i === index} onClick={() => goTo(i)} />
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
