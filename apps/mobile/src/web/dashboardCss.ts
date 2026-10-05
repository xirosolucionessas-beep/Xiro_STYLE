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
.xw-search-group { margin: 0; padding: var(--xw-space-2) var(--xw-space-4) var(--xw-space-1); color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); text-transform: uppercase; letter-spacing: .05em; }
.xw-result-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: var(--xw-radius-sm); background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-search-overlay { position: absolute; inset: 0; z-index: 70; display: flex; align-items: center; padding: var(--xw-space-2) var(--xw-space-2); background: var(--xw-background); }
.xw-search-overlay .xw-search { max-width: none; }
.xw-search-close { position: absolute; right: 0; color: var(--xw-text-muted); }
.xw-search-overlay .xw-search-input { padding-right: calc(var(--xw-touch) + var(--xw-space-1)); }

/* ================= Barra lateral: tarjeta del plan ================= */
.xw-side-extra { margin: 0 0 var(--xw-space-3); }
.xw-plan { position: relative; overflow: hidden; box-sizing: border-box; padding: var(--xw-space-4); border-radius: var(--xw-radius-lg); border: 1px solid var(--xw-accent);
  background: radial-gradient(120% 90% at 100% 0%, var(--xw-accent-tint), transparent 60%), var(--xw-surface-alt); }
.xw-plan.is-blocked, .xw-plan.is-grace { border-color: var(--xw-danger); }
.xw-plan-ic { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--xw-radius-md); background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-plan-title { margin: var(--xw-space-2) 0 0; font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-plan-text { margin: var(--xw-space-1) 0 var(--xw-space-3); color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-plan-cta { display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: var(--xw-touch); padding: 0 var(--xw-space-3); border-radius: var(--xw-radius-md); background: var(--xw-accent); color: var(--xw-on-accent); text-decoration: none; font: ${font.weight.extrabold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-plan-cta:hover { filter: brightness(1.08); }

/* ================= Tablero de Inicio ================= */
/* flex: 1 llena el alto de .xw-page (ver shellCss.ts): con poco contenido el pie (margin-top: auto, abajo) queda pegado al
   fondo real de la pantalla en vez de flotar a la mitad; con mucho contenido, .xw-dash simplemente crece y el pie va justo
   después, como cualquier otro bloque. */
.xw-dash { container-type: inline-size; display: flex; flex-direction: column; flex: 1; gap: var(--xw-space-5); padding: var(--xw-space-4) 0; }

.xw-hero { position: relative; display: flex; align-items: center; gap: var(--xw-space-5); flex-wrap: wrap; box-sizing: border-box; padding: var(--xw-space-6); border-radius: var(--xw-radius-xl); color: var(--xw-text); overflow: hidden;
  background: radial-gradient(90% 140% at 100% 0%, rgba(217, 182, 54, .28), transparent 55%), linear-gradient(135deg, #17140a 0%, #0d0d0f 65%);
  background-size: cover; background-position: center; border: 1px solid var(--xw-border-subtle); box-shadow: 0 24px 50px -30px rgba(217, 182, 54, .55); }
.xw-hero-brand { position: relative; flex: none; }
.xw-hero-logo { display: block; width: 72px; height: 72px; border-radius: var(--xw-radius-lg); overflow: hidden; border: 2px solid rgba(217, 182, 54, .6); }
.xw-hero-text { flex: 1 1 16rem; min-width: 0; }
.xw-hero-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-3xl)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-hero-sub { margin: var(--xw-space-2) 0 0; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-hero.has-photo .xw-hero-sub { color: #e6e1d3; }
.xw-hero-account { display: flex; align-items: center; gap: var(--xw-space-2); min-height: var(--xw-touch); padding: var(--xw-space-1) var(--xw-space-3); background: rgba(255, 255, 255, .06); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); cursor: pointer; font-family: var(--xw-font); }
.xw-hero-account:hover { background: rgba(255, 255, 255, .12); }
.xw-hero-account-text { display: flex; flex-direction: column; align-items: flex-end; min-width: 0; }

.xw-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--xw-space-4); }
.xw-kpi { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: var(--xw-space-1); box-sizing: border-box; min-width: 0; padding: var(--xw-space-4); text-align: left; font-family: var(--xw-font);
  background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); }
.xw-kpi--action { cursor: pointer; transition: background-color var(--xw-fast), border-color var(--xw-fast), transform var(--xw-fast); }
.xw-kpi--action:hover { background: var(--xw-surface-alt); border-color: var(--xw-accent); }
.xw-kpi--action:active { transform: scale(.99); }
.xw-kpi-ic { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; margin-bottom: var(--xw-space-1); border-radius: var(--xw-radius-md); background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-kpi-label { color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-kpi-value { max-width: 100%; overflow-wrap: anywhere; font: ${font.weight.extrabold} var(--xw-text-3xl)/1.1 var(--xw-font); }
.xw-kpi-skel { width: 60%; height: 32px; border-radius: var(--xw-radius-sm); }
.xw-kpi-hint { color: var(--xw-accent); font: ${font.weight.bold} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
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
[data-mode='mobile'] .xw-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--xw-space-3); }
[data-mode='mobile'] .xw-kpi { padding: var(--xw-space-3); }
[data-mode='mobile'] .xw-kpi-value { font-size: var(--xw-text-2xl); }
[data-mode='mobile'] .xw-dash { padding-bottom: 0; }
@media (min-width: ${layout.breakpoints.wide}px) { .xw-dash { gap: var(--xw-space-6); } }
`.trim();
}
