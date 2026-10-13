import { font, layout } from './tokens';

/** CSS del panel de inicio, botones flotantes, base de caja y la ficha de servicio (galería). Se añade a buildCss(). */
export function buildHomeCss(): string {
  return `
/* ---------- Botones flotantes ---------- */
/* column-reverse: el primer botón (WhatsApp) queda abajo; uno futuro (asistente) se añadiría encima con el mismo hueco de 12px. */
.xw-fab-stack { position: fixed; z-index: 4000; right: var(--xw-space-4); bottom: var(--xw-space-4); display: flex; flex-direction: column-reverse; align-items: center; gap: 12px; }
.xw-fab { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; text-decoration: none; box-shadow: 0 10px 26px -10px rgba(0, 0, 0, .55); transition: transform var(--xw-fast); }
.xw-fab:hover { transform: translateY(-2px); }
.xw-fab:active { transform: scale(.94); }
/* Sin animación continua (solo responde a una acción, p. ej. hover/active arriba): un pulso infinito compite por
   atención todo el tiempo, no solo cuando la persona interactúa. */
.xw-fab--whatsapp { background: var(--xw-whatsapp); }
/* Alto de la pila de flotantes (WhatsApp + Asistente, sección 4B/4C): 1rem del borde + 2×56px + 12px de hueco entre ellos
   = 8.75rem, más un poco de aire. Antes solo se reservaba para un botón (4.5rem): con los dos apilados tapaba contenido. */
[data-mode='mobile'] .xw-page { padding-bottom: calc(var(--xw-space-8) + 9.5rem); }

/* ---------- Panel de inicio (piezas que reutiliza el tablero: cámara del logo, nombre, aviso de WhatsApp) ---------- */
.xw-home-cam { position: absolute; right: -4px; bottom: -4px; width: 26px; height: 26px; border-radius: 50%; background: var(--xw-accent); color: var(--xw-on-accent); border: 2px solid var(--xw-background); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.xw-home-cam:hover { filter: brightness(1.05); }
.xw-home-name { font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-home-sub { color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-home-avatar { flex: none; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: var(--xw-accent-tint); border: 1.5px solid var(--xw-accent); color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-sm)/1 var(--xw-font); }

.xw-setup { display: flex; align-items: center; gap: var(--xw-space-3); padding: var(--xw-space-3); }
.xw-setup-ic { flex: none; color: var(--xw-accent); }
.xw-setup-text { flex: 1; min-width: 0; }
.xw-setup-chevron { flex: none; color: var(--xw-text-muted); }

.xw-actions-title { margin: 0 0 var(--xw-space-1); color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-actions-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--xw-space-2); }
@media (min-width: 860px) { .xw-actions-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--xw-space-3); } }
/* Monitor ancho: más columnas de accesos rápidos (más densidad), no tarjetas más anchas. */
@media (min-width: ${layout.breakpoints.wide}px) { .xw-actions-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.xw-tile { position: relative; display: flex; flex-direction: column; justify-content: space-between; gap: var(--xw-space-4); box-sizing: border-box; min-height: 6.25rem; padding: var(--xw-space-3); text-align: left; text-decoration: none;
  background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); font-family: var(--xw-font); transition: background-color var(--xw-fast), border-color var(--xw-fast), transform var(--xw-fast); }
a.xw-tile, button.xw-tile { cursor: pointer; }
.xw-tile:hover:not([aria-disabled='true']) { background: var(--xw-surface-alt); border-color: var(--xw-border); }
.xw-tile:active:not([aria-disabled='true']) { transform: scale(.98); }
/* Acabado premium: borde dorado fino (el acento de la app con opacidad), un poco más intenso al pasar el cursor. */
.xw-tile { border-color: color-mix(in srgb, var(--xw-accent) 45%, transparent); }
.xw-tile:hover:not([aria-disabled='true']) { border-color: color-mix(in srgb, var(--xw-accent) 75%, transparent); }
.xw-tile[aria-disabled='true'] { cursor: not-allowed; color: var(--xw-text-muted); }
.xw-tile-ic { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; color: var(--xw-text-muted); }
/* flex-wrap: a 200% de zoom o en columnas muy angostas, "Próximamente" baja a su propia línea en vez de desbordar la tarjeta. */
.xw-tile-bottom { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--xw-space-1) var(--xw-space-2); }
.xw-tile-label { min-width: 0; overflow-wrap: anywhere; font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-tile-soon { min-width: 0; overflow-wrap: anywhere; color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-tile-chevron { flex: none; color: var(--xw-text-muted); }
.xw-tile[aria-disabled='true'] .xw-tile-chevron { display: none; }

/* ---------- Base inicial del día (modal) ---------- */
.xw-cash-ic { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; margin: 0 auto var(--xw-space-3); border-radius: 50%; background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-cash-q { margin: 0 0 var(--xw-space-4); text-align: center; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-cash-current { margin: 0 0 var(--xw-space-4); text-align: center; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-cash-current strong { color: var(--xw-text); font-weight: ${font.weight.extrabold}; }

/* ---------- Galería (ficha de servicio) ---------- */
.xw-gallery-main { position: relative; isolation: isolate; width: 100%; aspect-ratio: 4 / 3; overflow: hidden; border-radius: var(--xw-radius-xl); background: var(--xw-surface-alt); }
.xw-gallery-track { display: flex; height: 100%; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.xw-gallery-track::-webkit-scrollbar { display: none; }
.xw-gallery-slide { flex: 0 0 100%; height: 100%; scroll-snap-align: start; }
.xw-gallery-slide button { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.xw-gallery-slide img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.xw-gallery-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--xw-space-2); color: var(--xw-text-muted); }
.xw-gallery-arrow { position: absolute; top: 50%; z-index: 2; transform: translateY(-50%); width: 40px; height: 40px; border-radius: 50%; background: rgba(13, 13, 15, .55); color: #fff; border: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: opacity var(--xw-fast); }
.xw-gallery-main:hover .xw-gallery-arrow, .xw-gallery-arrow:focus-visible { opacity: 1; }
.xw-gallery-arrow--prev { left: var(--xw-space-3); }
.xw-gallery-arrow--next { right: var(--xw-space-3); }
.xw-gallery-dots { position: absolute; z-index: 2; left: 50%; bottom: var(--xw-space-3); transform: translateX(-50%); display: flex; align-items: center; gap: 2px; padding: 0 4px; background: rgba(13, 13, 15, .5); border-radius: var(--xw-radius-pill); }
/* El botón cubre 24×24 (tamaño mínimo de objetivo, WCAG 2.5.8) aunque el punto visible sea más pequeño. */
.xw-gallery-dot { position: relative; width: 24px; height: 24px; padding: 0; border: 0; background: none; cursor: pointer; }
.xw-gallery-dot::after { content: ''; position: absolute; top: 50%; left: 50%; width: 7px; height: 7px; border-radius: 4px; background: rgba(255, 255, 255, .65); transform: translate(-50%, -50%); transition: width var(--xw-fast); }
.xw-gallery-dot.is-active::after { width: 18px; background: #fff; }
.xw-gallery-count { position: absolute; z-index: 2; top: var(--xw-space-3); right: var(--xw-space-3); padding: 2px 10px; background: rgba(13, 13, 15, .55); color: #fff; border-radius: var(--xw-radius-pill); font: ${font.weight.bold} var(--xw-text-xs)/1.6 var(--xw-font); }

.xw-thumbs-title { margin: var(--xw-space-5) 0 var(--xw-space-2); color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-thumbs { display: flex; gap: var(--xw-space-2); overflow-x: auto; padding-bottom: 2px; }
.xw-thumb { flex: 0 0 4.5rem; width: 4.5rem; height: 4.5rem; padding: 0; border: 2px solid transparent; border-radius: var(--xw-radius-md); overflow: hidden; background: var(--xw-surface-alt); cursor: pointer; }
.xw-thumb.is-active { border-color: var(--xw-accent); }
.xw-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* Visor a pantalla completa */
.xw-lightbox { position: fixed; inset: 0; z-index: 9200; display: flex; flex-direction: column; background: rgba(6, 6, 7, .94); }
.xw-lightbox-panel { display: flex; flex-direction: column; width: 100%; height: 100%; outline: none; }
.xw-lightbox-top { flex: none; display: flex; align-items: center; justify-content: space-between; padding: var(--xw-space-3) var(--xw-space-4); color: #fff; }
.xw-lightbox-count { font: ${font.weight.bold} var(--xw-text-sm)/1 var(--xw-font); }
.xw-lightbox-tools { display: flex; align-items: center; gap: var(--xw-space-2); }
.xw-lightbox-btn { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: rgba(255, 255, 255, .12); color: #fff; border: 0; cursor: pointer; }
.xw-lightbox-btn:hover { background: rgba(255, 255, 255, .2); }
.xw-lightbox-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; }
.xw-lightbox-img-btn { display: flex; max-width: 92%; max-height: 92%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.xw-lightbox-img-btn:has(.is-zoomed) { cursor: zoom-out; }
.xw-lightbox-img { max-width: 100%; max-height: 100%; object-fit: contain; transition: transform .2s ease; user-select: none; pointer-events: none; }
.xw-lightbox-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 48px; height: 48px; border-radius: 50%; background: rgba(255, 255, 255, .12); color: #fff; border: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.xw-lightbox-arrow:hover { background: rgba(255, 255, 255, .2); }
.xw-lightbox-arrow--prev { left: var(--xw-space-4); }
.xw-lightbox-arrow--next { right: var(--xw-space-4); }
.xw-lightbox-bottom { flex: none; display: flex; justify-content: center; gap: 6px; padding: var(--xw-space-3); }

/* ---------- Ficha (servicio, artículo, cliente) ---------- */
.xw-detail { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--xw-space-5); align-items: start; }
@container (min-width: 52rem) { .xw-detail { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }
.xw-detail-media, .xw-detail-side { display: flex; flex-direction: column; gap: var(--xw-space-4); min-width: 0; }
/* Ficha "Lo que ve tu cliente": las fotos completas (sin recorte) sobre un fondo neutro, como en la página pública. */
.xw-detail--preview .xw-gallery-slide img { object-fit: contain; background: radial-gradient(120% 120% at 50% 40%, var(--xw-surface), var(--xw-surface-alt)); }
.xw-detail-duration { color: var(--xw-text-muted); font-weight: 500; font-size: var(--xw-text-md); }
.xw-detail-desc--pre { white-space: pre-line; }
.xw-detail-variants { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--xw-space-2); }
.xw-detail-variants li { display: flex; justify-content: space-between; gap: var(--xw-space-3); padding: var(--xw-space-2) 0; border-top: 1px solid var(--xw-border-subtle); font: var(--xw-text-md)/1.4 var(--xw-font); color: var(--xw-text); }
.xw-detail-variants li span:first-child { min-width: 0; overflow-wrap: anywhere; }
.xw-detail-variants li span:last-child { flex: none; color: var(--xw-text-muted); white-space: nowrap; }
.xw-detail-desc { margin: 0; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-detail-price { margin: 0; color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-3xl)/1.1 var(--xw-font); }
.xw-detail-actions { display: flex; flex-direction: column; gap: var(--xw-space-3); margin-top: var(--xw-space-2); }
.xw-detail-public { display: inline-flex; align-items: center; justify-content: center; gap: var(--xw-space-2); min-height: var(--xw-touch); }
.xw-dl { margin: 0; display: flex; flex-direction: column; }
.xw-dl-row { display: flex; flex-direction: column; gap: 2px; padding: var(--xw-space-3) 0; border-bottom: 1px solid var(--xw-border-subtle); }
.xw-dl-row:last-child { border-bottom: 0; }
.xw-dl-row dt { color: var(--xw-text-muted); font: ${font.weight.medium} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-dl-row dd { margin: 0; color: var(--xw-text); overflow-wrap: anywhere; font: ${font.weight.semibold} var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-dl-row dd a { color: var(--xw-accent); text-underline-offset: 3px; }

@media (max-width: 639px) {
  /* Al último acceso rápido lo tapa la pila de flotantes (WhatsApp + Asistente): le deja el hueco fijo despejado. */
  .xw-actions-grid > :last-child { margin-bottom: 9.5rem; }
}

`.trim();
}
