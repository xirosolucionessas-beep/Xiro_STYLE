import { font, layout } from './tokens';

/** CSS de las pantallas de acceso: login, registro en pasos, recuperación, términos y sus componentes. Se añade a buildCss(). */
export function buildAuthCss(): string {
  return `
/* ---------- Página de autenticación ---------- */
.xw-auth { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; justify-content: center; box-sizing: border-box; padding: var(--xw-space-8) var(--xw-space-4) var(--xw-space-12); background: var(--xw-background); color: var(--xw-text); font-family: var(--xw-font); }
.xw-auth-in { width: 100%; max-width: 27.5rem; display: flex; flex-direction: column; gap: var(--xw-space-5); align-items: stretch; align-self: flex-start; }
.xw-auth-logo { align-self: center; display: block; border-radius: var(--xw-radius-lg); overflow: hidden; box-shadow: 0 8px 28px -10px color-mix(in srgb, var(--xw-accent) 55%, transparent); }
.xw-acard { box-sizing: border-box; padding: var(--xw-space-8) var(--xw-space-6); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: 1.75rem;
  box-shadow: 0 24px 60px -30px color-mix(in srgb, var(--xw-accent) 45%, transparent); animation: xw-enter 250ms ease-out both; }
.xw-atitle { margin: 0; text-align: center; font: ${font.weight.extrabold} var(--xw-text-2xl)/${font.lineHeight.tight} var(--xw-font); letter-spacing: -.015em; overflow-wrap: anywhere; }
.xw-atitle:focus { outline: none; }
.xw-asub { margin: var(--xw-space-2) 0 var(--xw-space-5); text-align: center; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-form { display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-form .xw-field { margin-bottom: 0; }
/* En móvil "display: contents" hace que este envoltorio no exista para el layout: los campos siguen apilados
   como siempre, uno debajo del otro. Solo en tablet+ (ver media query más abajo) pasa a ser una fila de 2 columnas. */
.xw-field-pair { display: contents; }
.xw-alinks { display: flex; justify-content: center; margin-top: var(--xw-space-1); }
.xw-alink { display: inline-flex; align-items: center; min-height: var(--xw-touch); color: var(--xw-accent); font-weight: ${font.weight.bold}; text-decoration: underline; text-underline-offset: 3px; }
.xw-alink:hover { opacity: .85; }
.xw-switch-auth { margin: var(--xw-space-2) 0; text-align: center; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-switch-auth .xw-alink { margin-left: var(--xw-space-1); }
.xw-link-btn { display: inline-flex; align-items: center; min-height: var(--xw-touch); padding: 0 var(--xw-space-2); background: none; border: 0; color: var(--xw-accent); font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.xw-link-btn:disabled { opacity: .55; cursor: not-allowed; }

.xw-fmsg { margin: 0; padding: var(--xw-space-3) var(--xw-space-4); border: 2px solid var(--xw-danger); border-radius: var(--xw-radius-md); color: var(--xw-danger); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-fmsg--info { border-color: var(--xw-border); color: var(--xw-text); }
.xw-note { display: flex; align-items: flex-start; flex-wrap: wrap; gap: var(--xw-space-2) var(--xw-space-3); box-sizing: border-box; margin: 0; padding: var(--xw-space-3) var(--xw-space-4); background: var(--xw-accent-tint); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-md); color: var(--xw-text); font: ${font.weight.medium} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-note > svg { flex: none; margin-top: 2px; color: var(--xw-accent); }
.xw-note > span { flex: 1 1 12rem; min-width: 0; }
.xw-note p { margin: 0; flex: 1 1 100%; }
.xw-note--warn { border: 2px solid var(--xw-warning); }
.xw-note--dev { border: 2px dashed var(--xw-border); }
.xw-note-actions { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); flex: 1 1 100%; }

/* ---------- Casilla ---------- */
.xw-check-wrap { margin: 0; }
.xw-check { display: flex; align-items: flex-start; gap: var(--xw-space-3); min-height: var(--xw-touch); }
.xw-check input { flex: none; width: 1.5rem; height: 1.5rem; margin: .625rem 0 0; accent-color: var(--xw-accent); cursor: pointer; }
.xw-check label { padding: var(--xw-space-2) 0; color: var(--xw-text); font: ${font.weight.medium} var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); cursor: pointer; }
.xw-check label .xw-alink { display: inline; min-height: 0; }

/* ---------- Opciones (radios nativos) ---------- */
.xw-rg { min-width: 0; }
.xw-rg > .xw-label { display: block; }
.xw-rg-list { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); }
.xw-rg-list--card { flex-direction: column; }
.xw-rcard { position: relative; display: inline-flex; cursor: pointer; }
.xw-rcard input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.xw-rcard--pill { align-items: center; min-height: var(--xw-touch); box-sizing: border-box; padding: 0 var(--xw-space-4); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-pill); color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-rcard--pill:has(input:checked) { border-color: var(--xw-accent); background: var(--xw-accent-tint); color: var(--xw-accent); font-weight: ${font.weight.extrabold}; }
.xw-rcard--card { display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; width: 100%; min-height: 3.75rem; padding: var(--xw-space-3) var(--xw-space-4); background: var(--xw-surface); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-lg); transition: background-color var(--xw-fast), border-color var(--xw-fast); }
.xw-rcard--card:hover { background: var(--xw-surface-alt); }
.xw-rcard--card:has(input:checked) { border-color: var(--xw-accent); background: var(--xw-accent-tint); }
.xw-rcard--success:has(input:checked) { border-color: var(--xw-success); background: color-mix(in srgb, var(--xw-success) 12%, transparent); }
.xw-rcard:has(input:focus-visible) { outline: 2px solid var(--xw-focus); outline-offset: 2px; }
.xw-rcard-ic { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 2rem; color: var(--xw-accent); }
.xw-rcard-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.xw-rcard-label { color: var(--xw-text); font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-rcard-desc { color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-rcard-check { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--xw-accent); color: var(--xw-on-accent); opacity: 0; }
.xw-rcard--success .xw-rcard-check { background: var(--xw-success); color: var(--xw-background); }
.xw-rcard--card:has(input:checked) .xw-rcard-check { opacity: 1; }

/* ---------- Pasos ---------- */
.xw-stepper { margin: 0 0 var(--xw-space-5); }
.xw-stepper-label { margin: 0 0 var(--xw-space-2); text-align: center; color: var(--xw-accent); font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-stepper-bar { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; }
.xw-stepper-dot { height: 6px; border-radius: var(--xw-radius-pill); background: var(--xw-border); transition: background-color var(--xw-base); }
.xw-stepper-dot.is-done { background: var(--xw-accent); }

/* ---------- Contraseña ---------- */
.xw-pw { margin: calc(var(--xw-space-1) * -1) 0 var(--xw-space-1); }
.xw-pw-rules { display: grid; gap: var(--xw-space-1); margin: 0; padding: 0; list-style: none; }
.xw-pw-rule { display: flex; align-items: center; gap: var(--xw-space-2); color: var(--xw-text-muted); font: ${font.weight.medium} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-pw-rule.is-met { color: var(--xw-success); }
.xw-pw-rule-ic { display: inline-flex; }
.xw-pw-meter-wrap { display: flex; align-items: center; gap: var(--xw-space-3); margin-top: var(--xw-space-2); }
.xw-pw-meter { display: flex; flex: 1; gap: 4px; }
.xw-pw-seg { flex: 1; height: 6px; border-radius: var(--xw-radius-pill); background: var(--xw-border); }
.xw-pw-seg.is-on.s1 { background: var(--xw-danger); }
.xw-pw-seg.is-on.s2 { background: var(--xw-warning); }
.xw-pw-seg.is-on.s3, .xw-pw-seg.is-on.s4 { background: var(--xw-success); }
.xw-pw-meter-text { min-width: 4.5rem; text-align: right; color: var(--xw-text-muted); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }

/* ---------- Código de 6 dígitos ---------- */
.xw-otp { display: flex; justify-content: center; gap: var(--xw-space-2); }
.xw-otp-box { flex: 1; min-width: 0; max-width: 3.25rem; height: 3.5rem; box-sizing: border-box; padding: 0; text-align: center; background: var(--xw-surface); color: var(--xw-text); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-md); font: ${font.weight.extrabold} var(--xw-text-2xl)/1 var(--xw-font); caret-color: var(--xw-accent); }
.xw-otp-box:focus { border-color: var(--xw-focus); }
.xw-otp-box.is-invalid { border-color: var(--xw-danger); }
.xw-resend { margin: 0; text-align: center; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-resend time { font-variant-numeric: tabular-nums; font-weight: ${font.weight.bold}; color: var(--xw-text); }

/* ---------- Interruptor y horario ---------- */
.xw-switch-row { display: flex; align-items: center; gap: var(--xw-space-3); min-height: var(--xw-touch); margin-bottom: var(--xw-space-3); }
.xw-switch-row label { flex: 1; min-width: 0; color: var(--xw-text); font: ${font.weight.semibold} var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); cursor: pointer; }
.xw-switch { appearance: none; -webkit-appearance: none; position: relative; flex: none; order: 2; width: 3rem; height: 1.75rem; margin: 0; background: transparent; border: 2px solid var(--xw-border); border-radius: var(--xw-radius-pill); cursor: pointer; transition: background-color var(--xw-fast), border-color var(--xw-fast); }
.xw-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 1.25rem; height: 1.25rem; border-radius: 50%; background: var(--xw-text-muted); transition: transform var(--xw-fast), background-color var(--xw-fast); }
.xw-switch:checked { background: var(--xw-accent-tint); border-color: var(--xw-accent); }
.xw-switch:checked::after { transform: translateX(1.25rem); background: var(--xw-accent); }
.xw-hours-list { display: grid; gap: var(--xw-space-2); margin: 0 0 var(--xw-space-3); padding: 0; list-style: none; }
.xw-hours-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--xw-space-1) var(--xw-space-3); box-sizing: border-box; min-height: 3.25rem; padding: var(--xw-space-1) var(--xw-space-1) var(--xw-space-1) var(--xw-space-4); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); }
.xw-dot { flex: none; width: .625rem; height: .625rem; border-radius: 50%; background: var(--xw-border); }
.xw-dot.is-open { background: var(--xw-success); }
.xw-hours-day { flex: 1 1 7rem; min-width: 0; font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-hours-time { flex: 0 1 auto; color: var(--xw-accent); font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); font-variant-numeric: tabular-nums; }
.xw-hours-edit { margin-right: 0; color: var(--xw-accent); }
.xw-time { border: 0; padding: 0; margin: 0 0 var(--xw-space-3); min-width: 0; }
.xw-time legend { padding: 0; }
.xw-time-row { display: flex; align-items: center; gap: var(--xw-space-2); }
.xw-time-row .xw-control { flex: 1; }
.xw-time-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--xw-space-4); }

/* ---------- Selector de país ---------- */
.xw-cp { position: relative; }
.xw-cp-anchor { position: relative; }
.xw-cp-btn { width: 100%; box-sizing: border-box; min-height: calc(var(--xw-touch) + 6px); border-width: 2px; border-color: var(--xw-border); cursor: pointer; text-align: left;
  font: ${font.weight.semibold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); transition: border-color var(--xw-fast); }
.xw-cp-btn:hover { border-color: var(--xw-accent); }
.xw-cp-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.xw-cp-dial { color: var(--xw-text-muted); font-variant-numeric: tabular-nums; }
.xw-cp-list { position: absolute; z-index: 40; left: 0; right: 0; top: calc(100% + 4px); box-sizing: border-box; max-height: 17rem; overflow-y: auto; margin: 0; padding: 4px; list-style: none;
  background: var(--xw-surface); color: var(--xw-text); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-md); box-shadow: 0 16px 40px -12px rgba(0, 0, 0, .45); }
.xw-cp-opt { display: flex; align-items: center; gap: var(--xw-space-3); min-height: var(--xw-touch); padding: 0 var(--xw-space-3); border-radius: var(--xw-radius-sm); cursor: pointer; font: ${font.weight.medium} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-cp-opt.is-active { background: var(--xw-accent-tint); }
.xw-cp-opt.is-selected { font-weight: ${font.weight.extrabold}; }
.xw-cp-check { display: inline-flex; width: 1.25rem; color: var(--xw-accent); }

/* ---------- Celular: código de país compacto (bandera + prefijo) junto al número ---------- */
.xw-phone-wrap { position: relative; }
.xw-phone-dial { flex: none; display: inline-flex; align-items: center; gap: var(--xw-space-2); box-sizing: border-box; height: var(--xw-touch); padding: 0 var(--xw-space-3);
  background: var(--xw-surface-tint); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-md); color: var(--xw-text); cursor: pointer; font: ${font.weight.bold} var(--xw-text-md)/1 var(--xw-font); transition: border-color var(--xw-fast); }
.xw-phone-dial:hover { border-color: var(--xw-accent); }
.xw-phone-dial-code { font-variant-numeric: tabular-nums; }
.xw-phone-list { right: auto; width: max(100%, 18rem); }

/* ---------- Hoja inferior de país (móvil): buscador + lista grande ---------- */
.xw-cs { display: flex; flex-direction: column; gap: var(--xw-space-3); min-height: 0; }
.xw-cs-search { gap: var(--xw-space-2); color: var(--xw-text-muted); }
.xw-cs-search input { color: var(--xw-text); }
.xw-cs-list { margin: 0; padding: 0; list-style: none; overflow-y: auto; max-height: min(60vh, 28rem); }
.xw-cs-opt { display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; width: 100%; min-height: 3.5rem; padding: var(--xw-space-2) var(--xw-space-2); background: transparent; border: 0; border-radius: var(--xw-radius-md);
  color: var(--xw-text); text-align: left; cursor: pointer; font: ${font.weight.medium} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }
.xw-cs-opt:hover { background: var(--xw-surface-alt); }
.xw-cs-opt.is-selected { background: var(--xw-accent-tint); font-weight: ${font.weight.extrabold}; }
.xw-cs-empty { padding: var(--xw-space-6) var(--xw-space-3); color: var(--xw-text-muted); text-align: center; font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }

/* ---------- Foto ---------- */
.xw-photo { display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-photo-zone { overflow: hidden; background: var(--xw-surface-alt); border: 2px dashed var(--xw-border); border-radius: var(--xw-radius-xl); }
.xw-photo-zone.has-photo { border-style: solid; }
.xw-photo-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--xw-space-2); box-sizing: border-box; width: 100%; min-height: 11rem; padding: var(--xw-space-6); background: transparent; border: 0; color: var(--xw-text); cursor: pointer; font-family: var(--xw-font); }
.xw-photo-empty:hover { background: var(--xw-accent-tint); }
.xw-photo-plus { display: inline-flex; align-items: center; justify-content: center; width: 3.5rem; height: 3.5rem; border-radius: 50%; background: var(--xw-accent); color: var(--xw-on-accent); }
.xw-photo-title { font: ${font.weight.extrabold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }
.xw-photo-optional { color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-photo-img { display: block; width: 100%; max-height: 16rem; object-fit: cover; }
.xw-photo-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--xw-space-2); padding: var(--xw-space-3); }
.xw-photo-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: var(--xw-space-3); }
.xw-cam { position: relative; aspect-ratio: 4 / 3; overflow: hidden; background: #000; border-radius: var(--xw-radius-lg); }
.xw-cam video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.xw-cam-wait { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: #fff; font: ${font.weight.semibold} var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }

/* ---------- Términos ---------- */
.xw-terms { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--xw-background); color: var(--xw-text); font-family: var(--xw-font); }
.xw-terms-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--xw-space-8) var(--xw-space-4); }
.xw-terms-in { max-width: 44rem; margin: 0 auto; }
.xw-terms-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-3xl)/${font.lineHeight.tight} var(--xw-font); letter-spacing: -.02em; }
.xw-terms-in .xw-asub { text-align: left; }
.xw-terms-list { display: grid; gap: var(--xw-space-4); margin: 0; padding: 0; list-style: none; }
.xw-tcard { display: flex; align-items: flex-start; gap: var(--xw-space-4); padding: var(--xw-space-5); background: var(--xw-surface-tint); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-xl); }
.xw-tcard-num { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; background: var(--xw-accent-tint); border: 1px solid var(--xw-accent); color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-lg)/1 var(--xw-font); }
.xw-tcard-title { margin: 0 0 var(--xw-space-1); color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }
.xw-tcard-body { margin: 0; font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-wlink--inline { display: inline-flex; min-height: 0; vertical-align: baseline; gap: var(--xw-space-1); text-decoration: underline; text-underline-offset: 3px; }
.xw-terms-foot { flex: none; padding: var(--xw-space-3) var(--xw-space-4); background: var(--xw-surface); border-top: 1px solid var(--xw-border-subtle); }
.xw-terms-foot-in { max-width: 44rem; margin: 0 auto; }

@media (max-width: 639px) {
  .xw-auth { padding: var(--xw-space-4) var(--xw-space-3) var(--xw-space-10); }
  .xw-acard { padding: var(--xw-space-6) var(--xw-space-4); }
}
@media (max-width: 419px) {
  .xw-time-grid, .xw-photo-buttons { grid-template-columns: 1fr; }
}
/* Tablet+: los pasos del registro que agrupan 2 campos afines (nombre/negocio, dirección/ciudad) pasan a una fila de
   2 columnas y la tarjeta gana algo más de ancho para que no queden apretados. Login/Recuperación no tienen ningún
   .xw-field-pair, así que :has() no los afecta — se quedan exactamente como están. */
@media (min-width: ${layout.breakpoints.tablet}px) {
  .xw-auth-in:has(.xw-field-pair) { max-width: 34rem; }
  .xw-field-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--xw-space-3); align-items: start; }
}
@media (prefers-reduced-motion: reduce) {
  .xw-acard { animation: none !important; }
}
`.trim();
}
