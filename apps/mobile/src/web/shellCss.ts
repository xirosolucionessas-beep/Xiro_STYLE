import { font, layout, remOf } from './tokens';

/** CSS del layout web (sidebar, barra superior, drawer, migas, pantallas). Se añade a buildCss(). */
export function buildShellCss(): string {
  return `
/* ---------- Layout de aplicación ---------- */
.xw-app { display: flex; flex: 1; width: 100%; height: 100%; min-width: 0; background: var(--xw-background); color: var(--xw-text); font-family: var(--xw-font); }
.xw-col { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; }
.xw-main { flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; position: relative; }
.xw-main:focus { outline: none; }

.xw-sidebar { flex: none; display: flex; flex-direction: column; box-sizing: border-box; width: ${remOf(layout.sidebarWidth)}; height: 100%; overflow-y: auto; overflow-x: hidden;
  padding: var(--xw-space-4) var(--xw-space-3); background: var(--xw-surface); border-right: 1px solid var(--xw-border-subtle); transition: width var(--xw-base) ease; }
.xw-sidebar[data-collapsed='true'] { width: ${remOf(layout.sidebarCollapsedWidth)}; align-items: center; padding-inline: var(--xw-space-2); }

.xw-brand { display: flex; align-items: center; gap: var(--xw-space-3); min-height: ${remOf(56)}; padding: var(--xw-space-2); color: var(--xw-text); }
.xw-logo { display: block; flex: none; width: 2.5rem; height: 2.5rem; }
.xw-logo-fallback { display: block; width: 100%; height: 100%; border-radius: var(--xw-radius-md); background: var(--xw-surface-alt); }
.xw-brand-name { font: ${font.weight.extrabold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }

.xw-nav-list { flex: 1; display: flex; flex-direction: column; gap: var(--xw-space-1); list-style: none; margin: var(--xw-space-4) 0 var(--xw-space-4); padding: 0; width: 100%; }
.xw-tipwrap { position: relative; display: block; }
.xw-nav-item { position: relative; display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; min-height: var(--xw-touch); padding: 0 var(--xw-space-3);
  border-radius: var(--xw-radius-md); color: var(--xw-text-muted); text-decoration: none; font: ${font.weight.semibold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
a.xw-nav-item:hover { background: var(--xw-surface-alt); color: var(--xw-text); }
a.xw-nav-item:active { background: var(--xw-accent-tint); }
/* El estado activo no depende solo del color: barra lateral + peso + fondo. */
.xw-nav-item[aria-current='page'] { background: var(--xw-surface-alt); color: var(--xw-text); font-weight: ${font.weight.semibold}; box-shadow: inset 3px 0 0 var(--xw-accent); }
.xw-nav-item.is-disabled { cursor: not-allowed; }
.xw-nav-label { flex: 1; min-width: 0; overflow-wrap: break-word; }
.xw-nav-stack { display: flex; flex-direction: column; min-width: 0; padding: 6px 0; }
.xw-nav-soon { color: var(--xw-text-muted); font: ${font.weight.medium} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-sidebar[data-collapsed='true'] .xw-nav-item { justify-content: center; width: var(--xw-touch); padding: 0; }
.xw-sidebar[data-collapsed='true'] .xw-tipwrap { display: flex; justify-content: center; }

.xw-collapse { display: flex; align-items: center; justify-content: center; gap: var(--xw-space-2); box-sizing: border-box; min-height: var(--xw-touch); min-width: var(--xw-touch); width: 100%; padding: 0 var(--xw-space-3);
  background: transparent; color: var(--xw-text-muted); border: 1px solid var(--xw-border); border-radius: var(--xw-radius-md); cursor: pointer; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-collapse:hover { background: var(--xw-surface-alt); color: var(--xw-text); }
.xw-collapse:active { background: var(--xw-accent-tint); }
.xw-sidebar[data-collapsed='true'] .xw-collapse { width: var(--xw-touch); padding: 0; }

.xw-tip { position: absolute; z-index: 50; left: 100%; top: 50%; transform: translateY(-50%); margin-left: var(--xw-space-2); padding: 6px var(--xw-space-3);
  background: var(--xw-text); color: var(--xw-background); border-radius: var(--xw-radius-sm); font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); white-space: nowrap; }

/* ---------- Barra superior y migas ---------- */
.xw-topbar { flex: none; display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; min-height: ${remOf(56)}; padding: var(--xw-space-2) var(--xw-space-6); background: var(--xw-background); border-bottom: 1px solid var(--xw-border-subtle); }
[data-mode='mobile'] .xw-topbar { padding-inline: var(--xw-space-2); }
.xw-menu-btn { margin-right: 0; border: 1px solid var(--xw-border); color: var(--xw-text); }
.xw-crumbs ol { display: flex; flex-wrap: wrap; align-items: center; gap: var(--xw-space-1) var(--xw-space-2); margin: 0; padding: 0; list-style: none; font: ${font.weight.medium} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-crumbs li + li::before { content: '›' / ''; margin-right: var(--xw-space-2); color: var(--xw-text-muted); }
.xw-crumbs a { display: inline-flex; align-items: center; min-height: var(--xw-touch); color: var(--xw-text-muted); text-decoration: none; }
.xw-crumbs a:hover { color: var(--xw-text); text-decoration: underline; text-underline-offset: 3px; }
.xw-crumbs [aria-current='page'] { color: var(--xw-text); font-weight: ${font.weight.semibold}; }

/* ---------- Drawer (móvil) ---------- */
.xw-drawer-root { position: fixed; inset: 0; z-index: 9000; background: var(--xw-overlay); }
.xw-drawer { position: absolute; top: 0; bottom: 0; left: 0; box-sizing: border-box; width: min(20rem, 88vw); overflow-y: auto; padding: var(--xw-space-4) var(--xw-space-3);
  background: var(--xw-surface); border-right: 1px solid var(--xw-border); animation: xw-slide var(--xw-base) ease-out; }
.xw-drawer:focus { outline: none; }
.xw-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-2); }
@keyframes xw-slide { from { transform: translateX(-100%); } to { transform: none; } }

/* ---------- Estado de datos: barra de carga y aviso de error ---------- */
.xw-progress { position: absolute; z-index: 5; top: 0; left: 0; right: 0; height: 3px; overflow: hidden; background: var(--xw-accent-tint); }
.xw-progress::after { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: var(--xw-accent); animation: xw-bar 1.1s ease-in-out infinite; }
@keyframes xw-bar { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.xw-banner { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; width: calc(100% - 2 * var(--xw-space-6)); max-width: var(--xw-page-max, ${remOf(layout.maxContent)}); margin: var(--xw-space-3) auto 0;
  padding: var(--xw-space-3) var(--xw-space-4); background: var(--xw-surface); color: var(--xw-text); border: 2px solid var(--xw-danger); border-radius: var(--xw-radius-lg); }
[data-mode='mobile'] .xw-banner { width: calc(100% - 2 * var(--xw-space-4)); }
.xw-banner-ic { flex: none; display: inline-flex; color: var(--xw-danger); }
.xw-banner-msg { flex: 1 1 12rem; min-width: 0; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }

/* ---------- Pantalla (Screen / Header web) ---------- */
/* .xw-page imita el contenedor en columna de React Native: sus hijos (Text en línea incluidos) se apilan como bloques. */
.xw-screen { flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; }
.xw-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
/* min-height: 100% (no auto): con poco contenido la página llena el alto visible, y una pantalla cuyo pie use "margin-top: auto"
   (el tablero de Inicio) queda pegado abajo del todo en vez de flotar a la mitad. Con contenido normal no cambia nada: solo
   entra en juego cuando hay espacio de sobra. */
.xw-page { display: flex; flex-direction: column; box-sizing: border-box; width: 100%; min-height: 100%; max-width: var(--xw-page-max, ${remOf(layout.maxContent)}); margin: 0 auto; padding: 0 var(--xw-space-6) var(--xw-space-8); }
[data-mode='mobile'] .xw-page { padding-inline: var(--xw-space-4); }
/* Centra el contenido (p. ej. una sola tarjeta de acceso) en vez de apilarlo desde arriba; con contenido que no cabe en
   el alto visible, .xw-scroll ya permite desplazar (no se pierde nada en pantallas chicas). Opt-in: solo la pantalla
   que lo pida (Screen "center"), el resto de /platform y de la app sigue igual. */
.xw-page--center { justify-content: center; align-items: center; }
.xw-head { display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; width: 100%; max-width: var(--xw-page-max, ${remOf(layout.maxContent)}); margin: 0 auto; padding: var(--xw-space-4) var(--xw-space-6); }
[data-mode='mobile'] .xw-head { padding-inline: var(--xw-space-4); }
.xw-head-text { flex: 1; min-width: 0; }
.xw-h1 { margin: 0; color: var(--xw-text); font: ${font.weight.extrabold} var(--xw-text-2xl)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-sub { margin: var(--xw-space-1) 0 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-back { flex: none; display: inline-flex; align-items: center; justify-content: center; width: var(--xw-touch); height: var(--xw-touch); background: var(--xw-accent-tint); color: var(--xw-accent); border: 1px solid var(--xw-accent); border-radius: var(--xw-radius-md); cursor: pointer; }
.xw-foot { flex: none; box-sizing: border-box; width: 100%; max-width: var(--xw-page-max, ${remOf(layout.maxContent)}); margin: 0 auto; padding: var(--xw-space-3) var(--xw-space-6); }
[data-mode='mobile'] .xw-foot { padding-inline: var(--xw-space-4); }

/* Monitores anchos/ultra-anchos: el dashboard (no los formularios angostos, que se quedan en su ancho) aprovecha
   más espacio horizontal sin estirar tarjetas individuales — la densidad la dan más columnas, no un ancho mayor por tarjeta. */
@media (min-width: ${layout.breakpoints.wide}px) {
  [data-page-width='default'] .xw-page, [data-page-width='default'] .xw-head, [data-page-width='default'] .xw-foot, [data-page-width='default'] .xw-banner { max-width: ${remOf(1440)}; }
}
`.trim();
}
