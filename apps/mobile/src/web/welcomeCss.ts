import { font } from './tokens';

/**
 * CSS de la bienvenida web y de los botones de acceso social (se añade a buildCss()).
 * Puntos de quiebre propios de esta pantalla: escritorio ≥ 1024 (dos mitades) · tablet 640–1023 (columna, panel compacto) · móvil < 640.
 */
export function buildWelcomeCss(): string {
  return `
/* ---------- Botón de acceso social (Google / Apple) ---------- */
.xw-social { position: relative; display: flex; align-items: center; justify-content: center; gap: var(--xw-space-3); box-sizing: border-box; width: 100%; min-height: var(--xw-touch); padding: var(--xw-space-1) var(--xw-space-4);
  border: 1px solid transparent; border-radius: var(--xw-radius-lg); cursor: pointer; font: ${font.weight.medium} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font);
  transition: box-shadow var(--xw-fast), transform var(--xw-fast), opacity var(--xw-fast); }
.xw-social--google { background: var(--xw-google-bg); color: var(--xw-google-text); border-color: var(--xw-google-border); }
.xw-social--apple { background: var(--xw-apple-bg); color: var(--xw-apple-text); border-color: var(--xw-apple-bg); }
.xw-social:hover:not([aria-disabled='true']) { box-shadow: 0 6px 18px -8px color-mix(in srgb, var(--xw-text) 45%, transparent); transform: translateY(-1px); }
.xw-social:active:not([aria-disabled='true']) { transform: none; box-shadow: none; opacity: .9; }
.xw-social[aria-disabled='true'] { cursor: not-allowed; }
.xw-social[data-soon='true'] { opacity: .72; }
.xw-social-ic { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; flex: none; }
.xw-social-text { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.xw-social-label { min-width: 0; text-align: center; overflow-wrap: anywhere; }
.xw-social-soon { padding: 1px var(--xw-space-2); border: 1px solid currentColor; border-radius: var(--xw-radius-pill); font: ${font.weight.bold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-social .xw-spinner { width: 1.15rem; height: 1.15rem; }
.xw-social-stack { display: flex; flex-direction: column; gap: var(--xw-space-3); width: 100%; }

/* Separador "o …" */
.xw-divider { display: flex; align-items: center; gap: var(--xw-space-3); margin: var(--xw-space-1) 0; color: var(--xw-text-muted); font: ${font.weight.medium} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-divider::before, .xw-divider::after { content: ''; flex: 1; height: 1px; background: var(--xw-border-subtle); }

/* ---------- Bienvenida ---------- */
.xw-welcome { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr; grid-template-rows: auto 1fr; overflow-y: auto; overflow-x: hidden; background: var(--xw-background); color: var(--xw-text); font-family: var(--xw-font); }

.xw-bp { position: relative; isolation: isolate; overflow: hidden; display: flex; flex-direction: column; justify-content: center; gap: var(--xw-space-6); box-sizing: border-box; padding: var(--xw-space-6) var(--xw-space-6);
  background: var(--xw-background); color: var(--xw-text); }
/* Trama geométrica fina (sin resplandores de color): el único gesto decorativo del panel. */
.xw-bp::after { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--xw-accent) 6%, transparent) 0 1px, transparent 1px 34px);
  -webkit-mask-image: radial-gradient(80% 70% at 30% 30%, #000, transparent 80%); mask-image: radial-gradient(80% 70% at 30% 30%, #000, transparent 80%); }

.xw-bp-brand { display: flex; align-items: center; gap: var(--xw-space-3); }
.xw-bp-logo { display: block; flex: none; border-radius: var(--xw-radius-lg); overflow: hidden; box-shadow: 0 6px 18px -10px color-mix(in srgb, var(--xw-accent) 35%, transparent); }
.xw-bp-name { font: ${font.weight.extrabold} var(--xw-text-xl)/${font.lineHeight.tight} var(--xw-font); letter-spacing: -.01em; }
.xw-bp-title { margin: 0; font: ${font.weight.extrabold} clamp(2rem, 4.4vw, 3.75rem)/1.05 var(--xw-font); letter-spacing: -.025em; }
.xw-bp-accent { color: inherit; }
.xw-bp-sub { margin: 0; max-width: 34rem; color: var(--xw-text-muted); font: ${font.weight.regular} var(--xw-text-lg)/${font.lineHeight.normal} var(--xw-font); }
.xw-bp-values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--xw-space-3); margin: 0; padding: 0; list-style: none; }
.xw-bp-value { display: flex; align-items: center; gap: var(--xw-space-3); font: ${font.weight.semibold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-bp-value-ic { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 2.5rem; height: 2.5rem; border-radius: var(--xw-radius-md);
  background: var(--xw-accent-tint); color: var(--xw-accent); border: 1px solid color-mix(in srgb, var(--xw-accent) 35%, transparent); }

/* .xw-wtools ya NO se posiciona absoluto sobre la tarjeta (podía quedar tapado si la tarjeta crecía): ambos son
   hijos normales de esta columna, así que estructuralmente nunca pueden superponerse. */
.xw-wpane { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; box-sizing: border-box; padding: var(--xw-space-6) var(--xw-space-4) var(--xw-space-8); }
.xw-wtools { position: static; z-index: 2; align-self: flex-end; flex: none; margin-bottom: var(--xw-space-3); display: flex; align-items: center; gap: var(--xw-space-3); }
.xw-wtools [role='radiogroup'] { display: flex; gap: var(--xw-space-2); }
.xw-round-btn { display: inline-flex; align-items: center; justify-content: center; width: var(--xw-touch); height: var(--xw-touch); background: transparent; color: var(--xw-accent); border: 1px solid var(--xw-border); border-radius: 50%; cursor: pointer; transition: background-color var(--xw-fast); }
.xw-round-btn:hover { background: var(--xw-accent-tint); }

/* margin: auto la centra verticalmente en el espacio que deja xw-wtools, sin poder invadirlo nunca. */
.xw-wcard { display: flex; flex-direction: column; gap: var(--xw-space-3); box-sizing: border-box; width: 100%; max-width: 26rem; margin: auto 0; padding: var(--xw-space-6) var(--xw-space-6);
  background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: 1.75rem; box-shadow: 0 24px 48px -28px rgba(0, 0, 0, .5);
  animation: xw-enter 250ms ease-out both; }
@keyframes xw-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.xw-wtitle { margin: 0; text-align: center; font: ${font.weight.extrabold} var(--xw-text-2xl)/${font.lineHeight.tight} var(--xw-font); letter-spacing: -.015em; }
.xw-wtag { margin: calc(var(--xw-space-2) * -1) 0 var(--xw-space-2); text-align: center; color: var(--xw-accent); font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-wactions { display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-wterms { align-self: center; display: inline-flex; align-items: center; min-height: var(--xw-touch); color: var(--xw-text-muted); font: ${font.weight.medium} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); text-decoration: underline; text-underline-offset: 3px; }
.xw-wterms:hover { color: var(--xw-accent); }
.xw-wsupport { display: flex; flex-direction: column; align-items: center; gap: var(--xw-space-1); padding-top: var(--xw-space-4); border-top: 1px solid var(--xw-border-subtle); text-align: center; }
.xw-wsupport-title { margin: 0; color: var(--xw-text-muted); font: ${font.weight.medium} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-wsupport-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 var(--xw-space-4); }
.xw-wlink { display: inline-flex; align-items: center; gap: var(--xw-space-2); min-height: var(--xw-touch); color: var(--xw-accent); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); text-decoration: none; overflow-wrap: anywhere; }
.xw-wlink:hover { text-decoration: underline; text-underline-offset: 3px; }
.xw-wmsg { margin: 0; text-align: center; color: var(--xw-danger); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-wmsg:empty { display: none; }

/* Tablet: columna; el panel de marca se compacta como cabecera (logo + titular + 4 puntos en 2×2). */
@media (min-width: 640px) {
  .xw-bp { padding: var(--xw-space-8) var(--xw-space-10); gap: var(--xw-space-5); }
  .xw-bp-title { font-size: clamp(2rem, 6vw, 2.75rem); }
}

/* Móvil web: columna única limpia, como la app nativa (logo grande centrado; el resto del panel no se muestra). */
@media (max-width: 639px) {
  .xw-bp { align-items: center; padding: var(--xw-space-8) var(--xw-space-4) var(--xw-space-4); }
  .xw-bp-brand { flex-direction: column; text-align: center; }
  .xw-bp-title, .xw-bp-sub, .xw-bp-values { display: none; }
  .xw-wcard { padding: var(--xw-space-6) var(--xw-space-4); }
  .xw-wpane { padding-top: var(--xw-space-4); }
}

/* Escritorio: dos mitades (≈55 % / 45 %) a alto completo. Tarjeta compacta (~416px) y sin aire muerto: en monitores
   grandes debe verse proporcionada junto al panel de marca, no ocupar media pantalla ni forzar scroll vertical. */
@media (min-width: 1024px) {
  .xw-welcome { grid-template-columns: minmax(0, 11fr) minmax(0, 9fr); grid-template-rows: 1fr; }
  .xw-bp { justify-content: center; gap: var(--xw-space-6); padding: var(--xw-space-12) clamp(3rem, 6vw, 6rem); }
  .xw-bp-title { font-size: clamp(2.25rem, 3.4vw, 3.25rem); }
  .xw-bp-values { grid-template-columns: 1fr; gap: var(--xw-space-3); }
  .xw-bp-sub { font-size: var(--xw-text-lg); }
  .xw-wpane { padding: var(--xw-space-6) var(--xw-space-8); }
  .xw-wcard { padding: var(--xw-space-6) var(--xw-space-6); }
}

/* Tarjeta compacta: mismo estilo, menos alto. Espacios, botones (40px, por encima del mínimo de 24px de WCAG 2.5.8) y enlaces
   de ayuda más ajustados, y la etiqueta "Próximamente" junto al nombre del proveedor en vez de debajo, para que el conjunto
   (desde el título hasta los datos de contacto) quepa en un portátil de 1366×768 sin desplazarse. */
.xw-wcard { gap: var(--xw-space-2); padding: var(--xw-space-5) var(--xw-space-6); }
.xw-wcard .xw-wtitle { font-size: var(--xw-text-xl); }
.xw-wcard .xw-wtag { margin: calc(var(--xw-space-1) * -1) 0 var(--xw-space-1); font-size: var(--xw-text-sm); }
.xw-wcard .xw-wactions, .xw-wcard .xw-social-stack { gap: var(--xw-space-2); }
.xw-wcard .xw-btn { min-height: 2.5rem; padding-block: var(--xw-space-1); font-size: var(--xw-text-md); }
.xw-wcard .xw-social { min-height: 2.5rem; padding-block: 0; }
.xw-wcard .xw-social-text { flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 2px var(--xw-space-2); }
.xw-wcard .xw-divider { margin: 0; font-size: var(--xw-text-xs); }
.xw-wcard .xw-wterms { min-height: 2rem; }
.xw-wcard .xw-wsupport { gap: 0; padding-top: var(--xw-space-2); }
.xw-wcard .xw-wlink { min-height: 2rem; }
@media (min-width: 1024px) {
  .xw-wpane { padding-block: var(--xw-space-4); }
  .xw-wcard { padding: var(--xw-space-5) var(--xw-space-6); }
}

@media (prefers-reduced-motion: reduce) {
  .xw-bp::before, .xw-wcard { animation: none !important; }
}
`.trim();
}
