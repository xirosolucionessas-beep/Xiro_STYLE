import { font } from './tokens';

/**
 * CSS de las pantallas de sección de la web (encabezado de página, filtros, buscador, tablas, tarjetas de producto,
 * insignias, estados). Comparte tokens y componentes con el Inicio (dashboardCss.ts). Se añade a buildCss().
 */
export function buildPagesCss(): string {
  return `
/* ================= Encabezado de página (todas las secciones) ================= */
.xw-head { gap: var(--xw-space-4); padding-top: var(--xw-space-6); padding-bottom: var(--xw-space-4); flex-wrap: wrap; }
.xw-head-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: var(--xw-radius-lg); background: var(--xw-accent-tint); color: var(--xw-accent); border: 1px solid var(--xw-accent); }
.xw-head .xw-h1 { font-size: var(--xw-text-3xl); letter-spacing: -.01em; }
.xw-head-actions { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: var(--xw-space-2); }
.xw-head .xw-sub { max-width: 46rem; }
[data-mode='mobile'] .xw-head { padding-top: var(--xw-space-4); }
[data-mode='mobile'] .xw-head-ic { width: 44px; height: 44px; }
[data-mode='mobile'] .xw-head-actions { flex: 1 1 100%; }
[data-mode='mobile'] .xw-head-actions .xw-btn { flex: 1 1 auto; }
[data-mode='mobile'] .xw-head .xw-h1 { font-size: var(--xw-text-2xl); }

/* Contenido de sección */
.xw-section { container-type: inline-size; display: flex; flex-direction: column; gap: var(--xw-space-5); padding-bottom: 7rem; }
[data-mode='mobile'] .xw-section { padding-bottom: 0; }
.xw-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--xw-space-3); }
.xw-toolbar .xw-searchfield { flex: 1 1 18rem; }

.xw-searchfield { position: relative; display: flex; align-items: center; min-width: 0; }
.xw-searchfield-ic { position: absolute; left: var(--xw-space-3); display: inline-flex; color: var(--xw-text-muted); pointer-events: none; }
.xw-searchfield-input { box-sizing: border-box; width: 100%; min-height: var(--xw-touch); padding: 0 var(--xw-space-4) 0 calc(var(--xw-space-3) + 26px); background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border); border-radius: var(--xw-radius-pill);
  font: ${font.weight.regular} var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-searchfield-input::placeholder { color: var(--xw-text-muted); opacity: 1; }
.xw-searchfield-input:focus { border-color: var(--xw-focus); }
.xw-searchfield-input::-webkit-search-cancel-button { display: none; }

.xw-fchips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--xw-space-2); }
.xw-fchips-label { margin-right: var(--xw-space-1); color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); text-transform: uppercase; letter-spacing: .05em; }
.xw-fchip { min-height: var(--xw-touch); padding: 0 var(--xw-space-4); background: transparent; color: var(--xw-text-muted); border: 1px solid var(--xw-border); border-radius: var(--xw-radius-pill); cursor: pointer;
  font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); transition: background-color var(--xw-fast), color var(--xw-fast), border-color var(--xw-fast); }
.xw-fchip:hover { background: var(--xw-surface-alt); color: var(--xw-text); }
.xw-fchip[aria-pressed='true'] { background: var(--xw-accent-tint); color: var(--xw-accent); border-color: var(--xw-accent); font-weight: ${font.weight.extrabold}; }

/* ================= Insignias ================= */
.xw-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px var(--xw-space-3); border-radius: var(--xw-radius-pill); background: transparent; color: var(--xw-text); border: 1px solid var(--xw-border); font: ${font.weight.bold} var(--xw-text-xs)/1.6 var(--xw-font); white-space: nowrap; }
.xw-badge-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--xw-text-muted); }
.xw-badge.is-success { border-color: var(--xw-success); } .xw-badge.is-success .xw-badge-dot { background: var(--xw-success); }
.xw-badge.is-warning { border-color: var(--xw-warning); } .xw-badge.is-warning .xw-badge-dot { background: var(--xw-warning); }
.xw-badge.is-danger { border-color: var(--xw-danger); } .xw-badge.is-danger .xw-badge-dot { background: var(--xw-danger); }
.xw-badge.is-accent { border-color: var(--xw-accent); background: var(--xw-accent-tint); } .xw-badge.is-accent .xw-badge-dot { background: var(--xw-accent); }
.xw-kpi-ic.is-success { color: var(--xw-success); } .xw-kpi-ic.is-warning { color: var(--xw-warning); } .xw-kpi-ic.is-danger { color: var(--xw-danger); }

/* ================= Tablas (Clientes, Inventario) ================= */
.xw-tablewrap { overflow-x: auto; background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); }
.xw-table { width: 100%; border-collapse: collapse; font-family: var(--xw-font); }
.xw-table caption { text-align: left; }
.xw-table th { padding: var(--xw-space-3) var(--xw-space-4); text-align: left; color: var(--xw-text-muted); border-bottom: 1px solid var(--xw-border-subtle); font: ${font.weight.bold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.xw-table td { padding: var(--xw-space-3) var(--xw-space-4); border-bottom: 1px solid var(--xw-border-subtle); color: var(--xw-text); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); vertical-align: middle; }
.xw-table tbody tr { position: relative; transition: background-color var(--xw-fast); }
.xw-table tbody tr:hover { background: var(--xw-surface-alt); }
.xw-table tbody tr:last-child td { border-bottom: 0; }
.xw-table .is-num { text-align: right; font-variant-numeric: tabular-nums; }
.xw-table .is-muted { color: var(--xw-text-muted); }
.xw-cell-main { display: flex; align-items: center; gap: var(--xw-space-3); min-width: 0; }
.xw-cell-text { display: flex; flex-direction: column; min-width: 0; }
.xw-cell-title { color: var(--xw-text); text-decoration: none; font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
/* Toda la fila es clicable: el enlace del nombre se estira sobre ella (un solo enlace real por fila para teclado y lector de pantalla). */
.xw-cell-title::after { content: ''; position: absolute; inset: 0; }
.xw-cell-title:focus-visible::after { outline: 2px solid var(--xw-focus); outline-offset: -2px; border-radius: var(--xw-radius-md); }
.xw-cell-sub { color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-thumb { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; overflow: hidden; border-radius: var(--xw-radius-md); background: var(--xw-surface-alt); color: var(--xw-accent); }
.xw-thumb img { width: 100%; height: 100%; object-fit: cover; }
.xw-row-chev { color: var(--xw-text-muted); }

/* Móvil: cada fila se vuelve una tarjeta (sin scroll horizontal). */
@container (max-width: 40rem) {
  .xw-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .xw-table, .xw-table tbody, .xw-table tr, .xw-table td { display: block; }
  .xw-table tbody tr { padding: var(--xw-space-3) var(--xw-space-4); border-bottom: 1px solid var(--xw-border-subtle); }
  .xw-table tbody tr:last-child { border-bottom: 0; }
  .xw-table td { padding: 2px 0; border: 0; }
  .xw-table td[data-label]::before { content: attr(data-label) ': '; color: var(--xw-text-muted); }
  .xw-table .is-num { text-align: left; }
  .xw-table td.xw-td-chev { display: none; }
}

/* ================= Tarjetas de producto/servicio ================= */
.xw-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: var(--xw-space-4); }
.xw-itemcard { position: relative; display: flex; flex-direction: column; overflow: hidden; background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); text-decoration: none; transition: border-color var(--xw-fast), transform var(--xw-fast), background-color var(--xw-fast); }
.xw-itemcard:hover { border-color: var(--xw-accent); transform: translateY(-2px); }
.xw-itemcard-photo { display: flex; align-items: center; justify-content: center; aspect-ratio: 4 / 3; background: var(--xw-surface-alt); color: var(--xw-accent); overflow: hidden; }
.xw-itemcard-photo img { width: 100%; height: 100%; object-fit: cover; }
.xw-itemcard-body { display: flex; flex-direction: column; gap: var(--xw-space-1); padding: var(--xw-space-4); min-width: 0; }
.xw-itemcard-title { color: var(--xw-text); text-decoration: none; font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-itemcard-title::after { content: ''; position: absolute; inset: 0; }
.xw-itemcard-title:focus-visible::after { outline: 2px solid var(--xw-focus); outline-offset: -2px; border-radius: var(--xw-radius-lg); }
.xw-itemcard-desc { margin: 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.xw-itemcard-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-2); margin-top: var(--xw-space-2); }
.xw-price { color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }

/* ================= Estados ================= */
.xw-emptypanel { display: flex; flex-direction: column; align-items: center; gap: var(--xw-space-2); padding: var(--xw-space-10) var(--xw-space-4); text-align: center; background: var(--xw-surface); border: 1px dashed var(--xw-border); border-radius: var(--xw-radius-lg); }
.xw-emptypanel-ic { display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-emptypanel-title { margin: var(--xw-space-1) 0 0; font: ${font.weight.bold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }
.xw-errorpanel { display: flex; flex-wrap: wrap; align-items: center; gap: var(--xw-space-3); padding: var(--xw-space-4); background: var(--xw-surface); border: 2px solid var(--xw-danger); border-radius: var(--xw-radius-lg); }
.xw-errorpanel-ic { display: inline-flex; color: var(--xw-danger); }
.xw-errorpanel-msg { flex: 1 1 12rem; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }

/* ================= Rejilla de paneles (Ajustes, Reportes, Citas) ================= */
.xw-panels { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--xw-space-4); align-items: start; }
@container (min-width: 56rem) { .xw-panels { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.xw-panels--3 { grid-template-columns: minmax(0, 1fr); }
@container (min-width: 44rem) { .xw-panels--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (min-width: 60rem) { .xw-panels--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.xw-span-all { grid-column: 1 / -1; }

/* Filas de ajustes / listas de enlaces dentro de un panel */
.xw-linklist { list-style: none; margin: 0; padding: 0; }
.xw-linkrow { display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; width: 100%; min-height: var(--xw-touch); padding: var(--xw-space-2) var(--xw-space-2); margin: 0; background: transparent; color: var(--xw-text); border: 0; border-radius: var(--xw-radius-md); text-align: left; text-decoration: none; cursor: pointer; font-family: var(--xw-font); }
.xw-linkrow:hover { background: var(--xw-surface-alt); }
.xw-linkrow-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: var(--xw-radius-md); background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-linkrow.is-danger .xw-linkrow-ic { color: var(--xw-danger); }
.xw-linkrow.is-danger .xw-linkrow-title { color: var(--xw-danger); }
.xw-linkrow-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.xw-linkrow-title { font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-linkrow-sub { color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-linkrow-end { flex: none; color: var(--xw-text-muted); display: inline-flex; align-items: center; }

.xw-switch-hit { display: inline-flex; align-items: center; justify-content: center; flex: none; min-width: var(--xw-touch); min-height: var(--xw-touch); background: transparent; border: 0; padding: 0; cursor: pointer; }
.xw-switch-track { position: relative; width: 46px; height: 28px; border-radius: var(--xw-radius-pill); background: var(--xw-border); transition: background-color var(--xw-fast); }
.xw-switch-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform var(--xw-fast); }
.xw-switch-hit[aria-checked='true'] .xw-switch-track { background: var(--xw-accent); }
.xw-switch-hit[aria-checked='true'] .xw-switch-track::after { transform: translateX(18px); }
.xw-switch-hit:disabled { opacity: .55; cursor: not-allowed; }

/* ================= Reportes: barras ================= */
.xw-bars { display: flex; align-items: flex-end; gap: var(--xw-space-2); height: 12rem; padding-top: var(--xw-space-2); }
.xw-bar { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 6px; }
.xw-bar-fill { width: 100%; max-width: 3rem; min-height: 3px; border-radius: var(--xw-radius-sm) var(--xw-radius-sm) 0 0; background: linear-gradient(180deg, var(--xw-accent), color-mix(in srgb, var(--xw-accent) 45%, transparent)); }
.xw-bar.is-empty .xw-bar-fill { background: var(--xw-border); }
.xw-bar-label { color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-bar-value { color: var(--xw-text); font: ${font.weight.bold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-rank { list-style: none; margin: 0; padding: 0; counter-reset: rank; }
.xw-rank li { display: flex; align-items: center; gap: var(--xw-space-3); padding: var(--xw-space-2) 0; border-bottom: 1px solid var(--xw-border-subtle); counter-increment: rank; }
.xw-rank li:last-child { border-bottom: 0; }
.xw-rank li::before { content: counter(rank); flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--xw-accent-tint); color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-sm)/1 var(--xw-font); }
.xw-rank-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-rank-val { flex: none; font: ${font.weight.extrabold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }

/* ================= Próximamente (Citas) ================= */
.xw-soon-hero { display: flex; flex-direction: column; align-items: flex-start; gap: var(--xw-space-3); padding: var(--xw-space-8); border-radius: var(--xw-radius-xl); border: 1px solid var(--xw-border-subtle); color: var(--xw-text);
  background: radial-gradient(90% 140% at 100% 0%, rgba(217, 182, 54, .22), transparent 55%), linear-gradient(135deg, #17140a 0%, #0d0d0f 65%); }
.xw-soon-hero p { margin: 0; max-width: 40rem; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-soon-hero h2 { margin: 0; font: ${font.weight.extrabold} var(--xw-text-2xl)/${font.lineHeight.tight} var(--xw-font); }
.xw-feature { display: flex; align-items: flex-start; gap: var(--xw-space-3); }
.xw-feature-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--xw-radius-md); background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-feature h3 { margin: 0; font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-feature p { margin: 2px 0 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }

a.xw-btn { text-decoration: none; }

/* Pantallas de formulario y ajustes internos (ancho angosto): el contenido va en una tarjeta, como los paneles del resto. */
[data-page-width='form'] .xw-screen .xw-page { box-sizing: border-box; width: calc(100% - 2 * var(--xw-space-6)); max-width: calc(var(--xw-page-max) - 2 * var(--xw-space-6)); margin-block: var(--xw-space-2) var(--xw-space-8); padding: var(--xw-space-6); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-xl); }
[data-mode='mobile'] [data-page-width='form'] .xw-screen .xw-page { width: calc(100% - 2 * var(--xw-space-4)); padding: var(--xw-space-4); }

/* ================= Notificaciones ================= */
.xw-nlist { list-style: none; margin: 0; padding: 0; }
.xw-nrow { display: flex; align-items: center; gap: var(--xw-space-2); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-nrow:last-child { border-bottom: 0; }
.xw-nrow.is-read { opacity: .72; }
.xw-nrow-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; min-height: var(--xw-touch); padding: var(--xw-space-3) var(--xw-space-2); margin: 0; background: transparent; color: var(--xw-text); border: 0; border-radius: var(--xw-radius-md); text-align: left; cursor: pointer; font-family: var(--xw-font); }
.xw-nrow-main:hover { background: var(--xw-surface-alt); }
.xw-nrow-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--xw-radius-md); background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-nrow-ic.is-urgent { color: var(--xw-danger); }
.xw-nrow-ic.is-warning { color: var(--xw-warning); }

/* ================= Sin conexión con el servidor (pantalla de arranque) ================= */
.xw-conn { position: fixed; inset: 0; z-index: 8000; display: flex; align-items: center; justify-content: center; padding: var(--xw-space-4); overflow: auto; color: var(--xw-text); font-family: var(--xw-font);
  background: radial-gradient(60% 55% at 50% 45%, rgba(217, 182, 54, .2), transparent 70%), radial-gradient(50% 50% at 90% 95%, rgba(217, 182, 54, .1), transparent 70%), #0d0d0f; }
.xw-errcard { position: relative; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; width: min(26rem, 100%); padding: var(--xw-space-8) var(--xw-space-6) var(--xw-space-6); text-align: center; color: var(--xw-text);
  border-radius: var(--xw-radius-xl); border: 1px solid rgba(217, 182, 54, .45); background: rgba(14, 13, 10, .72); backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 0 0 1px rgba(217, 182, 54, .08), 0 30px 70px -24px rgba(0, 0, 0, .85), 0 0 46px -18px rgba(217, 182, 54, .45); animation: xw-errcard-in .45s cubic-bezier(.2, .8, .2, 1) both; }
.xw-errcard-ic { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; margin-bottom: var(--xw-space-4); border-radius: 50%; background: var(--xw-accent-tint); color: var(--xw-accent); border: 1px solid rgba(217, 182, 54, .45); box-shadow: 0 0 0 6px var(--xw-accent-tint); }
.xw-errcard-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-xl)/${font.lineHeight.tight} var(--xw-font); letter-spacing: -.01em; }
.xw-errcard-msg { margin: var(--xw-space-2) 0 var(--xw-space-6); max-width: 22rem; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-errcard .xw-btn { width: auto; min-width: 12rem; }
@keyframes xw-errcard-in { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }

/* ================= Diálogos (todos): más aire, sombra y fondo desenfocado ================= */
.xw-backdrop { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.xw-modal { box-shadow: 0 40px 90px -30px rgba(0, 0, 0, .75); border-color: var(--xw-border-subtle); animation: xw-rise var(--xw-base) ease-out; }
.xw-modal-title { font-size: var(--xw-text-xl); letter-spacing: -.01em; }

/* Base inicial del día */
.xw-cash-ic { width: 64px; height: 64px; border: 1px solid var(--xw-accent); box-shadow: 0 0 0 6px var(--xw-accent-tint); }
.xw-cash-current { display: table; margin-inline: auto; padding: var(--xw-space-1) var(--xw-space-4); border-radius: var(--xw-radius-pill); background: var(--xw-surface-alt); border: 1px solid var(--xw-border-subtle); }
.xw-cash-amount .xw-control { min-height: 3.5rem; }
.xw-cash-amount .xw-control input { font-size: var(--xw-text-2xl); font-weight: ${font.weight.extrabold}; }
.xw-cash-amount .xw-prefix { font-size: var(--xw-text-md); }

/* Barra de acción de pantallas con pie (p. ej. Enviar por WhatsApp): fija abajo, alineada con el contenido */
.xw-foot { position: sticky; bottom: 0; z-index: 3; padding-block: var(--xw-space-3); background: color-mix(in srgb, var(--xw-background) 88%, transparent); border-top: 1px solid var(--xw-border-subtle); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.xw-foot > * { width: 100%; }
[data-page-width='form'] .xw-foot { max-width: var(--xw-page-max); }

/* ================= Aviso de cookies (primer ingreso) ================= */
.xw-cookie { position: fixed; z-index: 4500; left: 50%; bottom: var(--xw-space-6); transform: translateX(-50%); box-sizing: border-box; width: min(34rem, calc(100vw - 2 * var(--xw-space-4)));
  padding: var(--xw-space-5); color: var(--xw-text); border-radius: var(--xw-radius-xl); border: 1px solid rgba(217, 182, 54, .45);
  background: rgba(14, 13, 10, .82); backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 0 0 1px rgba(217, 182, 54, .08), 0 30px 70px -24px rgba(0, 0, 0, .85), 0 0 46px -18px rgba(217, 182, 54, .45);
  animation: xw-cookie-in .5s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes xw-cookie-in { from { opacity: 0; transform: translate(-50%, 22px); } to { opacity: 1; transform: translate(-50%, 0); } }
.xw-cookie-head { display: flex; align-items: center; gap: var(--xw-space-3); margin-bottom: var(--xw-space-2); }
.xw-cookie-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--xw-radius-md); background: var(--xw-accent-tint); color: var(--xw-accent); border: 1px solid rgba(217, 182, 54, .4); }
.xw-cookie-title { margin: 0; font: 800 var(--xw-text-lg)/1.25 var(--xw-font); letter-spacing: -.01em; }
.xw-cookie-body { margin: 0 0 var(--xw-space-4); color: var(--xw-text-muted); font: var(--xw-text-sm)/1.6 var(--xw-font); }
.xw-cookie-body a { color: var(--xw-accent); text-underline-offset: 3px; }
.xw-cookie-btn { width: 100%; }
[data-mode='mobile'] .xw-cookie { bottom: var(--xw-space-3); padding: var(--xw-space-4); }

/* Botones de la cabecera de página: mismo lenguaje que el Inicio */
.xw-head .xw-btn { min-height: var(--xw-touch); }
`.trim();
}
