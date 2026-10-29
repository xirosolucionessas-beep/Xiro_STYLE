import { font, layout } from './tokens';

/** CSS del rediseño web: cabecera (buscador, campana, mensajes, perfil), tarjeta del plan y tablero de Inicio. Se añade a buildCss(). */
export function buildDashboardCss(): string {
  return `
/* ================= Cabecera del rediseño ================= */
.xw-topbar-search { flex: 1 1 auto; min-width: 0; display: flex; justify-content: center; }
.xw-topbar-tools { flex: none; display: flex; align-items: center; gap: var(--xw-space-2); margin-left: auto; }
[data-mode='mobile'] .xw-topbar-search { flex: 0 0 auto; margin-left: auto; }
[data-mode='mobile'] .xw-topbar-tools { margin-left: 0; gap: var(--xw-space-1); }
[data-mode='mobile'] .xw-topbar { position: relative; }
[data-mode='mobile'] .xw-crumbs { display: none; }

.xw-tool { position: relative; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: var(--xw-touch); min-height: var(--xw-touch); background: transparent; color: var(--xw-text-muted);
  border: 1px solid transparent; border-radius: var(--xw-radius-md); cursor: pointer; transition: background-color var(--xw-fast), color var(--xw-fast), border-color var(--xw-fast); }
.xw-tool:hover, .xw-tool[aria-expanded='true'] { background: var(--xw-surface-alt); color: var(--xw-text); border-color: var(--xw-border-subtle); }
.xw-tool-badge { position: absolute; top: 2px; right: 2px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--xw-radius-pill);
  background: var(--xw-danger); color: var(--xw-background); border: 2px solid var(--xw-background); font: ${font.weight.extrabold} 11px/1 var(--xw-font); }

.xw-pop { position: relative; }
.xw-pop-panel { position: absolute; z-index: 60; top: calc(100% + var(--xw-space-2)); right: 0; box-sizing: border-box; width: min(24rem, calc(100vw - 2rem)); max-height: min(28rem, 70vh); overflow-y: auto;
  background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border); border-radius: var(--xw-radius-lg); box-shadow: 0 24px 48px -20px rgba(0, 0, 0, .6); animation: xw-rise var(--xw-base) ease-out; }
[data-mode='mobile'] .xw-pop { position: static; }
[data-mode='mobile'] .xw-pop-panel { position: fixed; top: 4.25rem; right: 1rem; left: 1rem; width: auto; }
.xw-pop-head { display: flex; align-items: center; justify-content: space-between; padding: var(--xw-space-3) var(--xw-space-4); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-pop-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-pop-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); padding: var(--xw-space-2) var(--xw-space-4); border-top: 1px solid var(--xw-border-subtle); }
.xw-pop-list { list-style: none; margin: 0; padding: 0; }
.xw-pop-empty { margin: 0; padding: var(--xw-space-4); color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-pop-empty-block { display: flex; flex-direction: column; align-items: center; text-align: center; padding: var(--xw-space-4) 0; }
.xw-pop-empty-block .xw-pop-empty { padding-top: var(--xw-space-1); }
.xw-pop-empty-ic { color: var(--xw-accent); }
.xw-pop-empty-title { margin: var(--xw-space-2) 0 0; font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-link-btn { display: inline-flex; align-items: center; min-height: var(--xw-touch); padding: 0 var(--xw-space-1); background: transparent; border: 0; color: var(--xw-accent); cursor: pointer; text-decoration: underline; text-underline-offset: 3px;
  font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-link-btn:hover { filter: brightness(1.15); }

.xw-notif, .xw-result { display: flex; align-items: flex-start; gap: var(--xw-space-3); box-sizing: border-box; min-height: var(--xw-touch); padding: var(--xw-space-3) var(--xw-space-4); color: var(--xw-text); text-decoration: none; border-bottom: 1px solid var(--xw-border-subtle); }
.xw-notif:hover, .xw-result:hover, .xw-result.is-active { background: var(--xw-surface-alt); }
.xw-notif[data-unread='true'] { background: var(--xw-accent-tint); }
.xw-notif-dot { flex: none; width: 10px; height: 10px; margin-top: 6px; border-radius: 50%; background: var(--xw-accent); }
.xw-notif-dot.is-urgent { background: var(--xw-danger); }
.xw-notif-dot.is-warning { background: var(--xw-warning); }
.xw-notif-text { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.xw-notif-title { font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-notif-detail, .xw-notif-time { color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }

/* Perfil */
.xw-profile-btn { display: inline-flex; align-items: center; gap: var(--xw-space-2); box-sizing: border-box; min-height: var(--xw-touch); padding: var(--xw-space-1) var(--xw-space-2); background: transparent; color: var(--xw-text-muted);
  border: 1px solid transparent; border-radius: var(--xw-radius-lg); cursor: pointer; font-family: var(--xw-font); }
.xw-profile-btn:hover, .xw-profile-btn[aria-expanded='true'] { background: var(--xw-surface-alt); border-color: var(--xw-border-subtle); color: var(--xw-text); }
.xw-profile-text { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; text-align: left; }
.xw-profile-name { max-width: 11rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--xw-text); font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-profile-role { color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; width: 36px; height: 36px; border-radius: 50%; background: var(--xw-accent-tint); border: 1.5px solid var(--xw-accent); color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-sm)/1 var(--xw-font); }
.xw-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.xw-avatar--lg { width: 44px; height: 44px; font-size: var(--xw-text-lg); }
.xw-pop-panel--menu { width: min(17rem, calc(100vw - 2rem)); padding: var(--xw-space-2); }
.xw-menu-id { display: flex; align-items: center; gap: var(--xw-space-3); padding: var(--xw-space-3); border-bottom: 1px solid var(--xw-border-subtle); margin-bottom: var(--xw-space-1); }
.xw-menu-item { display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; width: 100%; min-height: var(--xw-touch); padding: 0 var(--xw-space-3); background: transparent; color: var(--xw-text); border: 0; border-radius: var(--xw-radius-md); cursor: pointer;
  text-align: left; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-menu-item:hover { background: var(--xw-surface-alt); }
.xw-menu-grow { flex: 1; }
.xw-menu-value { color: var(--xw-text-muted); font-weight: ${font.weight.medium}; }
.xw-menu-item--danger { color: var(--xw-danger); }

/* Buscador */
.xw-search { position: relative; display: flex; align-items: center; width: 100%; max-width: 34rem; }
.xw-search-ic { position: absolute; left: var(--xw-space-3); display: inline-flex; color: var(--xw-text-muted); pointer-events: none; }
.xw-search-input { box-sizing: border-box; width: 100%; min-height: var(--xw-touch); padding: 0 var(--xw-space-4) 0 calc(var(--xw-space-3) + 26px); background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border); border-radius: var(--xw-radius-pill);
  font: ${font.weight.regular} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-search-input::placeholder { color: var(--xw-text-muted); opacity: 1; }
.xw-search-input:focus { border-color: var(--xw-focus); }
.xw-search-input::-webkit-search-cancel-button { display: none; }
.xw-search-panel { left: 0; right: 0; width: auto; top: calc(100% + var(--xw-space-1)); }
[data-mode='mobile'] .xw-search-panel { position: absolute; top: calc(100% + var(--xw-space-1)); left: 0; right: 0; }
.xw-search-status { margin: 0; padding: var(--xw-space-2) var(--xw-space-4); color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.normal} var(--xw-font); }
.xw-search-group { margin: 0; padding: var(--xw-space-2) var(--xw-space-4) var(--xw-space-1); color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-result-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: var(--xw-radius-sm); background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-search-overlay { position: absolute; inset: 0; z-index: 70; display: flex; align-items: center; padding: var(--xw-space-2) var(--xw-space-2); background: var(--xw-background); }
.xw-search-overlay .xw-search { max-width: none; }
.xw-search-close { position: absolute; right: 0; color: var(--xw-text-muted); }
.xw-search-overlay .xw-search-input { padding-right: calc(var(--xw-touch) + var(--xw-space-1)); }

/* ================= Barra lateral: tarjeta del plan ================= */
.xw-side-extra { margin: 0 0 var(--xw-space-3); }
/* Franja compacta (punto de aviso + texto corto + enlace), no una tarjeta grande: un solo renglón que envuelve si falta ancho. */
.xw-plan { display: flex; align-items: center; flex-wrap: wrap; box-sizing: border-box; gap: var(--xw-space-2); padding: var(--xw-space-3); border-radius: var(--xw-radius-md); border: 1px solid var(--xw-border-subtle); background: var(--xw-surface-alt); }
.xw-plan.is-blocked, .xw-plan.is-grace { border-color: var(--xw-danger); }
.xw-plan-ic { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; flex: none; color: var(--xw-text-muted); }
.xw-plan.is-blocked .xw-plan-ic, .xw-plan.is-grace .xw-plan-ic { color: var(--xw-danger); }
.xw-plan-title { margin: 0; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-plan-text { margin: 0; color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.normal} var(--xw-font); }
.xw-plan-cta { margin-left: auto; display: inline-flex; align-items: center; box-sizing: border-box; min-height: var(--xw-touch); padding: 0 var(--xw-space-2); color: var(--xw-accent); text-decoration: underline; text-underline-offset: 3px; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-plan-cta:hover { color: var(--xw-text); }

/* ================= Tablero de Inicio ================= */
/* flex: 1 llena el alto de .xw-page (ver shellCss.ts): con poco contenido el pie (margin-top: auto, abajo) queda pegado al
   fondo real de la pantalla en vez de flotar a la mitad; con mucho contenido, .xw-dash simplemente crece y el pie va justo
   después, como cualquier otro bloque. */
.xw-dash { container-type: inline-size; display: flex; flex-direction: column; flex: 1; gap: var(--xw-space-5); padding: var(--xw-space-4) 0; }

.xw-hero { position: relative; display: flex; align-items: center; gap: var(--xw-space-5); flex-wrap: wrap; box-sizing: border-box; padding: var(--xw-space-6); border-radius: var(--xw-radius-xl); color: var(--xw-text); overflow: hidden;
  background: var(--xw-surface-alt);
  background-size: cover; background-position: center; border: 1px solid var(--xw-border-subtle); box-shadow: 0 18px 40px -26px rgba(0, 0, 0, .6); }
.xw-hero-brand { position: relative; flex: none; }
.xw-hero-logo { display: block; width: 72px; height: 72px; border-radius: var(--xw-radius-lg); overflow: hidden; border: 2px solid rgba(217, 182, 54, .6); }
.xw-hero-text { flex: 1 1 16rem; min-width: 0; }
.xw-hero-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-3xl)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-hero-sub { margin: var(--xw-space-2) 0 0; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-hero.has-photo .xw-hero-sub { color: #e6e1d3; }
.xw-hero-account { display: flex; align-items: center; gap: var(--xw-space-2); min-height: var(--xw-touch); padding: var(--xw-space-1) var(--xw-space-3); background: rgba(255, 255, 255, .06); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); cursor: pointer; font-family: var(--xw-font); }
.xw-hero-account:hover { background: rgba(255, 255, 255, .12); }
.xw-hero-account-text { display: flex; flex-direction: column; align-items: flex-end; min-width: 0; }

/* Franja con separadores finos (sin ícono por métrica): una sola cifra dominante por celda, no una tarjeta por cada una. */
.xw-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); overflow: hidden; }
.xw-kpi { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: var(--xw-space-1); box-sizing: border-box; min-width: 0; padding: var(--xw-space-4); text-align: left; font-family: var(--xw-font);
  background: transparent; border-right: 1px solid var(--xw-border-subtle); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-kpi:last-child { border-right: 0; }
/* Inicio: la tira de cifras con el mismo borde dorado fino que los accesos de módulos. */
.xw-dash .xw-kpis { border-color: color-mix(in srgb, var(--xw-accent) 45%, transparent); }
.xw-kpi--action { cursor: pointer; transition: background-color var(--xw-fast); }
.xw-kpi--action:hover { background: var(--xw-surface-alt); }
.xw-kpi--action:active { transform: scale(.99); }
.xw-kpi-label { color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-kpi-value { max-width: 100%; overflow-wrap: anywhere; font: ${font.weight.extrabold} var(--xw-text-3xl)/1.1 var(--xw-font); font-variant-numeric: tabular-nums; }
.xw-kpi-skel { width: 60%; height: 32px; border-radius: var(--xw-radius-sm); }
.xw-kpi-hint { color: var(--xw-text-muted); font: ${font.weight.medium} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-trend { display: inline-flex; align-items: center; gap: 6px; margin-top: 2px; font: ${font.weight.bold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); color: var(--xw-text-muted); }
.xw-trend.is-up { color: var(--xw-success); }
.xw-trend.is-down { color: var(--xw-danger); }

.xw-dash-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--xw-space-4); align-items: start; }
.xw-dash-col { display: flex; flex-direction: column; gap: var(--xw-space-4); min-width: 0; }
@container (min-width: 60rem) { .xw-dash-grid { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }

.xw-panel { box-sizing: border-box; padding: var(--xw-space-5); background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); }
.xw-panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); margin-bottom: var(--xw-space-3); }
.xw-panel-title { display: flex; align-items: center; gap: var(--xw-space-2); margin: 0; font: ${font.weight.extrabold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }
.xw-panel-ic { display: inline-flex; color: var(--xw-accent); }
.xw-panel-sub { margin: calc(var(--xw-space-2) * -1) 0 var(--xw-space-3); color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-panel-empty { display: flex; align-items: center; gap: var(--xw-space-2); margin: 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-chip { display: inline-flex; align-items: center; padding: 2px var(--xw-space-3); border-radius: var(--xw-radius-pill); background: var(--xw-accent-tint); color: var(--xw-accent); border: 1px solid var(--xw-accent); font: ${font.weight.bold} var(--xw-text-xs)/1.6 var(--xw-font); }
.xw-rows-loading { display: flex; flex-direction: column; gap: var(--xw-space-2); }
.xw-rows-loading .xw-skeleton { height: 40px; border-radius: var(--xw-radius-sm); }
@container (min-width: 60rem) { .xw-dash .xw-actions-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (min-width: 84rem) { .xw-dash .xw-actions-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }

.xw-summary { display: flex; flex-direction: column; margin: 0; }
.xw-summary-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--xw-space-3); padding: var(--xw-space-2) 0; border-bottom: 1px solid var(--xw-border-subtle); }
.xw-summary-row:last-child { border-bottom: 0; }
.xw-summary-row dt { color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-summary-row dd { margin: 0; text-align: right; overflow-wrap: anywhere; font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }

.xw-stock { list-style: none; margin: 0; padding: 0; }
.xw-stock-row { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); box-sizing: border-box; min-height: var(--xw-touch); padding: var(--xw-space-1) var(--xw-space-2); margin: 0 calc(var(--xw-space-2) * -1); border-radius: var(--xw-radius-md); color: var(--xw-text); text-decoration: none; }
.xw-stock-row:hover { background: var(--xw-surface-alt); }
.xw-stock-name { min-width: 0; overflow-wrap: anywhere; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-stock-badge { flex: none; padding: 2px var(--xw-space-3); border-radius: var(--xw-radius-pill); background: transparent; color: var(--xw-text); border: 1px solid var(--xw-warning); font: ${font.weight.bold} var(--xw-text-xs)/1.6 var(--xw-font); }
.xw-stock-badge.is-out { border-color: var(--xw-danger); }

.xw-timeline { list-style: none; margin: 0; padding: 0; }
.xw-timeline-row { display: flex; align-items: center; gap: var(--xw-space-3); padding: var(--xw-space-3) 0; border-bottom: 1px solid var(--xw-border-subtle); }
.xw-timeline-row:last-child { border-bottom: 0; }
.xw-timeline-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-timeline-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.xw-timeline-title { overflow-wrap: anywhere; font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-timeline-detail { color: var(--xw-text-muted); overflow-wrap: anywhere; font: var(--xw-text-xs)/${font.lineHeight.normal} var(--xw-font); }
.xw-timeline-meta { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.xw-timeline-amount { font: ${font.weight.extrabold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-timeline-time { color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }

.xw-assistant { display: flex; align-items: center; gap: var(--xw-space-4); flex-wrap: wrap; box-sizing: border-box; padding: var(--xw-space-5); border-radius: var(--xw-radius-lg); color: var(--xw-text); border: 1px solid var(--xw-accent);
  background: radial-gradient(100% 140% at 0% 0%, rgba(217, 182, 54, .25), transparent 60%), #14120b; }
.xw-assistant-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: var(--xw-radius-md); background: var(--xw-accent); color: var(--xw-on-accent); }
.xw-assistant-text { flex: 1 1 10rem; min-width: 0; }
.xw-assistant-text p { margin: var(--xw-space-1) 0 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-assistant-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }

/* margin-top: auto lo empuja al fondo de .xw-dash cuando sobra alto; 10rem de relleno abajo (en el pie, no en toda la página)
   deja libre el hueco de los botones flotantes (WhatsApp + asistente, ~140px) sin que tapen sus enlaces. */
/* Sin relleno propio para los flotantes: .xw-page ya reserva ese hueco en móvil (ver homeCss.ts) para TODAS las
   pantallas, no solo esta; duplicarlo aquí es lo que dejaba la franja vacía enorme que se seguía viendo. */
.xw-dash-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--xw-space-3); margin-top: auto; padding: var(--xw-space-4) 0; border-top: 1px solid var(--xw-border-subtle); color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-dash-footer p { margin: 0; }
.xw-dash-footer nav { display: flex; flex-wrap: wrap; gap: var(--xw-space-1) var(--xw-space-4); }
.xw-dash-footer a { display: inline-flex; align-items: center; min-height: var(--xw-touch); color: var(--xw-accent); text-underline-offset: 3px; }

[data-mode='mobile'] .xw-hero { padding: var(--xw-space-4); gap: var(--xw-space-3); }
[data-mode='mobile'] .xw-hero-title { font-size: var(--xw-text-2xl); }
[data-mode='mobile'] .xw-hero-account { width: 100%; justify-content: space-between; }
[data-mode='mobile'] .xw-hero-account-text { align-items: flex-start; }
[data-mode='mobile'] .xw-panel { padding: var(--xw-space-4); }
[data-mode='mobile'] .xw-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
[data-mode='mobile'] .xw-kpi:nth-child(2n) { border-right: 0; }
[data-mode='mobile'] .xw-kpi { padding: var(--xw-space-3); }
[data-mode='mobile'] .xw-kpi-value { font-size: var(--xw-text-2xl); }
[data-mode='mobile'] .xw-dash { padding-bottom: 0; }
@media (min-width: ${layout.breakpoints.wide}px) { .xw-dash { gap: var(--xw-space-6); } }

/* ---------- Accesos rápidos (rediseño): icono en círculo dorado tenue, sombra suave y realce al pasar o tocar ---------- */
.xw-dash .xw-tile { gap: var(--xw-space-3); min-height: 7rem; padding: var(--xw-space-4); border-color: color-mix(in srgb, var(--xw-accent) 28%, var(--xw-border-subtle));
  background: linear-gradient(160deg, color-mix(in srgb, var(--xw-accent) 6%, var(--xw-surface)) 0%, var(--xw-surface) 55%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18), 0 6px 18px -12px rgba(0, 0, 0, .45);
  transition: background-color var(--xw-fast), border-color var(--xw-fast), box-shadow var(--xw-fast), transform var(--xw-fast); }
.xw-dash .xw-tile:hover:not([aria-disabled='true']) { transform: translateY(-2px); border-color: color-mix(in srgb, var(--xw-accent) 70%, transparent);
  box-shadow: 0 2px 4px rgba(0, 0, 0, .2), 0 14px 28px -14px color-mix(in srgb, var(--xw-accent) 45%, rgba(0, 0, 0, .6)); }
.xw-dash .xw-tile:active:not([aria-disabled='true']) { transform: translateY(0) scale(.98); box-shadow: 0 1px 2px rgba(0, 0, 0, .2); }
.xw-dash .xw-tile:focus-visible { outline: 2px solid var(--xw-accent); outline-offset: 2px; }
.xw-dash .xw-tile-ic { width: 44px; height: 44px; border-radius: 50%; color: var(--xw-accent); background: var(--xw-accent-tint);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--xw-accent) 30%, transparent); transition: background-color var(--xw-fast), transform var(--xw-fast); }
.xw-dash .xw-tile:hover:not([aria-disabled='true']) .xw-tile-ic { background: color-mix(in srgb, var(--xw-accent) 22%, transparent); transform: scale(1.05); }
.xw-dash .xw-tile-label { letter-spacing: .01em; }
/* La flecha siempre a la derecha, alineada con la última línea del nombre (antes bajaba sola en los nombres largos). */
.xw-dash .xw-tile-bottom { flex-wrap: nowrap; align-items: flex-end; }
.xw-dash .xw-tile-bottom .xw-tile-label { flex: 1; }
.xw-dash .xw-tile-chevron { transition: transform var(--xw-fast), color var(--xw-fast); }
.xw-dash .xw-tile:hover:not([aria-disabled='true']) .xw-tile-chevron { transform: translateX(3px); color: var(--xw-accent); }
@media (prefers-reduced-motion: reduce) {
  .xw-dash .xw-tile, .xw-dash .xw-tile-ic, .xw-dash .xw-tile-chevron { transition: none; }
  .xw-dash .xw-tile:hover:not([aria-disabled='true']), .xw-dash .xw-tile:hover:not([aria-disabled='true']) .xw-tile-ic, .xw-dash .xw-tile:hover:not([aria-disabled='true']) .xw-tile-chevron { transform: none; }
}

/* ---------- Flujo de caja diario ---------- */
.xw-cf { box-sizing: border-box; padding: var(--xw-space-5); border-radius: var(--xw-radius-lg); color: var(--xw-text); font-family: var(--xw-font);
  border: 1px solid color-mix(in srgb, var(--xw-accent) 45%, transparent);
  background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--xw-accent) 10%, transparent), transparent 55%), var(--xw-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18), 0 10px 26px -18px rgba(0, 0, 0, .5); }
.xw-cf-head { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: var(--xw-space-3); margin-bottom: var(--xw-space-4); }
.xw-cf-heading { display: flex; align-items: center; gap: var(--xw-space-3); min-width: 0; }
.xw-cf-badge { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-cf-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }
.xw-cf-sub { margin: 2px 0 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-cf-link { display: inline-flex; align-items: center; gap: 4px; min-height: var(--xw-touch); color: var(--xw-accent); text-decoration: none; font: ${font.weight.bold} var(--xw-text-sm)/1 var(--xw-font); }
.xw-cf-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.xw-cf-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--xw-space-4); }
@container (min-width: 48rem) { .xw-dash .xw-cf-body { grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); } }
.xw-cf-main { display: flex; flex-direction: column; gap: var(--xw-space-2); min-width: 0; }
.xw-cf-label { color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); text-transform: uppercase; letter-spacing: .06em; }
.xw-cf-net { font: ${font.weight.extrabold} var(--xw-text-3xl)/1.1 var(--xw-font); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.xw-cf-net.is-success { color: var(--xw-success); } .xw-cf-net.is-danger { color: var(--xw-danger); }
.xw-cf-flows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--xw-space-2); margin-top: var(--xw-space-1); }
.xw-cf-flow { display: flex; align-items: center; gap: var(--xw-space-2); min-width: 0; padding: var(--xw-space-2) var(--xw-space-3); border-radius: var(--xw-radius-md); border: 1px solid var(--xw-border-subtle); }
.xw-cf-flow.is-in { background: color-mix(in srgb, var(--xw-success) 9%, transparent); border-color: color-mix(in srgb, var(--xw-success) 30%, transparent); }
.xw-cf-flow.is-out { background: color-mix(in srgb, var(--xw-danger) 9%, transparent); border-color: color-mix(in srgb, var(--xw-danger) 30%, transparent); }
.xw-cf-flow-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; }
.xw-cf-flow.is-in .xw-cf-flow-ic { color: var(--xw-success); background: color-mix(in srgb, var(--xw-success) 16%, transparent); }
.xw-cf-flow.is-out .xw-cf-flow-ic { color: var(--xw-danger); background: color-mix(in srgb, var(--xw-danger) 16%, transparent); }
.xw-cf-flow-text { display: flex; flex-direction: column; min-width: 0; }
.xw-cf-flow-label { color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-cf-flow-value { font: ${font.weight.extrabold} var(--xw-text-md)/1.25 var(--xw-font); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.xw-cf-flow.is-in .xw-cf-flow-value { color: var(--xw-success); } .xw-cf-flow.is-out .xw-cf-flow-value { color: var(--xw-danger); }
.xw-cf-bar { display: flex; gap: 3px; height: 8px; border-radius: 999px; overflow: hidden; background: var(--xw-surface-alt); }
.xw-cf-bar-in { background: var(--xw-success); border-radius: 999px; } .xw-cf-bar-out { background: var(--xw-danger); border-radius: 999px; }
.xw-cf-note { margin: 0; color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.normal} var(--xw-font); }
.xw-cf-methods { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); margin: var(--xw-space-1) 0 0; padding: 0; list-style: none; }
.xw-cf-methods li { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--xw-border-subtle); background: var(--xw-surface-alt); color: var(--xw-text-muted); font: var(--xw-text-xs)/1.4 var(--xw-font); }
.xw-cf-methods strong { color: var(--xw-text); font-weight: ${font.weight.bold}; font-variant-numeric: tabular-nums; }
.xw-cf-cash { display: flex; flex-direction: column; justify-content: center; gap: var(--xw-space-1); min-width: 0; padding: var(--xw-space-4); border-radius: var(--xw-radius-md);
  border: 1px dashed color-mix(in srgb, var(--xw-accent) 40%, transparent); background: color-mix(in srgb, var(--xw-accent) 5%, transparent); }
.xw-cf-cash-value { font: ${font.weight.extrabold} var(--xw-text-2xl)/1.15 var(--xw-font); font-variant-numeric: tabular-nums; color: var(--xw-accent); overflow-wrap: anywhere; }
.xw-cf-delta { color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); font-variant-numeric: tabular-nums; }
.xw-cf-delta.is-success { color: var(--xw-success); } .xw-cf-delta.is-danger { color: var(--xw-danger); }
.xw-cf-base { display: flex; justify-content: space-between; gap: var(--xw-space-2); margin-top: var(--xw-space-2); padding-top: var(--xw-space-2); border-top: 1px solid var(--xw-border-subtle); color: var(--xw-text-muted); font: var(--xw-text-sm)/1.3 var(--xw-font); }
.xw-cf-base strong { color: var(--xw-text); font-variant-numeric: tabular-nums; }
.xw-cf-cash-ic { color: var(--xw-success); }
.xw-cf-cash-text { color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-cf-cash .xw-btn { align-self: flex-start; margin-top: var(--xw-space-1); }
[data-mode='mobile'] .xw-cf { padding: var(--xw-space-4); }
[data-mode='mobile'] .xw-cf-net { font-size: var(--xw-text-2xl); }
`.trim();
}
