import { buildShellCss } from './shellCss';
import { buildAssistantCss } from './assistantCss';
import { buildAuthCss } from './authCss';
import { buildHomeCss } from './homeCss';
import { buildEmployeesCss } from './employeesCss';
import { buildLoyaltyCss } from './loyaltyCss';
import { buildProfileCss } from './profileCss';
import { buildSubscriptionCss } from './subscriptionCss';
import { buildWelcomeCss } from './welcomeCss';
import { brand, colors, focusRing, font, layout, motion, radius, remOf, space, type ColorTokens, type ThemeName } from './tokens';

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function brandVars(theme: ThemeName): string {
  const s = brand.social[theme];
  return `--xw-google-bg: ${s.googleBg}; --xw-google-border: ${s.googleBorder}; --xw-google-text: ${s.googleText}; --xw-apple-bg: ${s.appleBg}; --xw-apple-text: ${s.appleText}; --xw-whatsapp: ${brand.whatsapp};`;
}

function themeVars(token: ColorTokens): string {
  return Object.entries(token)
    .map(([name, value]) => `--xw-${kebab(name)}: ${value};`)
    .join('\n  ');
}

/** CSS global del sistema de diseño web, generado a partir de los tokens (nunca escribir valores a mano aquí). */
export function buildCss(): string {
  const t = layout.touchTarget;
  return `
/* .xw-scope-dark: zona siempre oscura (p. ej. el panel de marca de la bienvenida) aunque la página esté en modo claro. */
:root, :root[data-theme='dark'], .xw-scope-dark { color-scheme: dark; ${themeVars(colors.dark)} ${brandVars('dark')} }
:root[data-theme='light'] { color-scheme: light; ${themeVars(colors.light)} ${brandVars('light')} }
:root {
  ${Object.entries(space).map(([k, v]) => `--xw-space-${k}: ${remOf(v)};`).join(' ')}
  ${Object.entries(radius).map(([k, v]) => `--xw-radius-${k}: ${v}px;`).join(' ')}
  ${Object.entries(font.size).map(([k, v]) => `--xw-text-${k}: ${remOf(v)};`).join(' ')}
  --xw-font: ${font.family};
  --xw-touch: ${remOf(t)};
  --xw-max-content: ${layout.maxContent}px;
  --xw-max-form: ${layout.maxForm}px;
  --xw-max-form-page: ${layout.maxFormPage}px;
  --xw-fast: ${motion.fast}ms;
  --xw-base: ${motion.base}ms;
}

/* Foco visible en todo elemento interactivo (WCAG 2.4.7 / 2.4.11). */
:where(a, button, input, select, textarea, summary, [tabindex], [role='button'], [role='radio'], [role='tab'], [role='switch'], [role='checkbox']):focus-visible {
  outline: ${focusRing.width}px solid var(--xw-focus) !important;
  outline-offset: ${focusRing.offset}px !important;
}

.xw-sr { position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

.xw-skip { position: fixed; top: var(--xw-space-2); left: var(--xw-space-2); z-index: 10000; transform: translateY(-200%);
  background: var(--xw-accent); color: var(--xw-on-accent); padding: var(--xw-space-3) var(--xw-space-4); border-radius: var(--xw-radius-md);
  font: 700 var(--xw-text-md)/1.25 var(--xw-font); text-decoration: none; }
.xw-skip:focus { transform: none; }

/* ---------- Botón ---------- */
.xw-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--xw-space-2); box-sizing: border-box;
  min-height: var(--xw-touch); min-width: var(--xw-touch); padding: var(--xw-space-2) var(--xw-space-5);
  border: 2px solid transparent; border-radius: var(--xw-radius-lg); cursor: pointer; text-align: center;
  font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); transition: background-color var(--xw-fast), border-color var(--xw-fast), opacity var(--xw-fast), transform var(--xw-fast); }
.xw-btn--sm { padding: var(--xw-space-1) var(--xw-space-3); border-radius: var(--xw-radius-md); font-size: var(--xw-text-sm); }
.xw-btn--block { display: flex; width: 100%; }
.xw-btn--primary { background: var(--xw-accent); color: var(--xw-on-accent); border-color: var(--xw-accent); }
.xw-btn--secondary { background: transparent; color: var(--xw-accent); border-color: var(--xw-accent); }
.xw-btn--ghost { background: transparent; color: var(--xw-text-muted); }
.xw-btn--danger { background: transparent; color: var(--xw-danger); border-color: var(--xw-danger); }
.xw-btn:hover:not([aria-disabled='true']):not(:disabled) { opacity: .88; }
.xw-btn--secondary:hover:not([aria-disabled='true']):not(:disabled), .xw-btn--ghost:hover:not([aria-disabled='true']):not(:disabled) { background: var(--xw-accent-tint); opacity: 1; }
.xw-btn:active:not([aria-disabled='true']):not(:disabled) { transform: scale(.97); opacity: 1; }
.xw-btn[aria-disabled='true'], .xw-btn:disabled { opacity: .55; cursor: not-allowed; }
.xw-spinner { width: 1em; height: 1em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: xw-spin .8s linear infinite; }
@keyframes xw-spin { to { transform: rotate(360deg); } }

/* ---------- Campos ---------- */
.xw-field { display: block; margin-bottom: var(--xw-space-4); font-family: var(--xw-font); }
.xw-label { display: block; margin-bottom: var(--xw-space-2); color: var(--xw-accent); font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-control { display: flex; align-items: center; gap: var(--xw-space-2); box-sizing: border-box; min-height: calc(var(--xw-touch) + 4px); padding: 0 var(--xw-space-3);
  background: var(--xw-surface); color: var(--xw-text); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-md); }
.xw-control:focus-within { border-color: var(--xw-focus); outline: ${focusRing.width}px solid var(--xw-focus); outline-offset: ${focusRing.offset}px; }
/* El anillo lo dibuja el contenedor redondeado; el control interno no dibuja el suyo (evita un doble contorno). */
.xw-control input:focus-visible, .xw-control select:focus-visible, .xw-control textarea:focus-visible { outline: none !important; }
.xw-control--invalid { border-color: var(--xw-danger); }
.xw-control--multiline { align-items: flex-start; padding-block: var(--xw-space-2); }
.xw-control input, .xw-control select, .xw-control textarea { flex: 1; min-width: 0; min-height: var(--xw-touch); box-sizing: border-box; background: transparent; color: inherit; border: 0; outline: 0;
  font: ${font.weight.regular} var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); padding: 0; }
.xw-control textarea { resize: vertical; min-height: 6rem; padding: var(--xw-space-2) 0; }
.xw-control select { appearance: none; padding-right: var(--xw-space-6); cursor: pointer; }
.xw-control select option { background: var(--xw-surface); color: var(--xw-text); }
.xw-control ::placeholder { color: var(--xw-text-muted); opacity: 1; }
.xw-prefix { color: var(--xw-accent); font-weight: ${font.weight.bold}; }
.xw-chevron { pointer-events: none; margin-left: calc(var(--xw-space-6) * -1); color: var(--xw-text-muted); }
.xw-icon-btn { display: inline-flex; align-items: center; justify-content: center; min-width: var(--xw-touch); min-height: var(--xw-touch); margin-right: calc(var(--xw-space-3) * -1);
  background: transparent; border: 0; color: var(--xw-text-muted); cursor: pointer; border-radius: var(--xw-radius-md); transition: background-color var(--xw-fast), color var(--xw-fast); }
.xw-icon-btn:hover { background: var(--xw-surface-alt); color: var(--xw-text); }
.xw-icon-btn:active { background: var(--xw-accent-tint); }
.xw-hint { margin: var(--xw-space-1) 0 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-error { display: flex; gap: var(--xw-space-2); align-items: flex-start; margin: var(--xw-space-1) 0 0; color: var(--xw-danger); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-error:empty { display: none; }

/* ---------- Tarjeta ---------- */
.xw-card { display: block; box-sizing: border-box; background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); padding: var(--xw-space-4); font-family: var(--xw-font); text-decoration: none; text-align: left; width: 100%; transition: background-color var(--xw-fast), border-color var(--xw-fast), transform var(--xw-fast); }
button.xw-card, a.xw-card { cursor: pointer; }
button.xw-card:hover, a.xw-card:hover { background: var(--xw-surface-alt); border-color: var(--xw-border); }
button.xw-card:active, a.xw-card:active { transform: scale(.99); }

/* ---------- Modal ---------- */
.xw-backdrop { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center; padding: var(--xw-space-4); background: var(--xw-overlay); }
.xw-modal { box-sizing: border-box; width: 100%; max-width: 32rem; max-height: calc(100vh - 2rem); overflow: auto; background: var(--xw-surface); color: var(--xw-text);
  border: 1px solid var(--xw-border); border-radius: var(--xw-radius-xl); padding: var(--xw-space-6); font-family: var(--xw-font); }
.xw-modal--lg { max-width: 48rem; }
.xw-modal:focus { outline: none; }
.xw-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--xw-space-3); margin-bottom: var(--xw-space-4); }
.xw-modal-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-xl)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-modal-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--xw-space-3); margin-top: var(--xw-space-6); }

/* Hoja inferior (bottom sheet): mismo diálogo accesible, anclado al borde inferior y a ancho completo. */
.xw-backdrop--sheet { align-items: flex-end; padding: 0; }
.xw-modal--sheet { max-width: 100%; max-height: 82vh; border-radius: var(--xw-radius-xl) var(--xw-radius-xl) 0 0; border-width: 1px 0 0; animation: xw-sheet-up var(--xw-base) ease-out; }
@keyframes xw-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .xw-modal--sheet { animation: none !important; } }

/* ---------- Toast ---------- */
.xw-toasts { position: fixed; z-index: 9500; left: 0; right: 0; bottom: var(--xw-space-4); display: flex; flex-direction: column; align-items: center; gap: var(--xw-space-2); padding: 0 var(--xw-space-4); pointer-events: none; }
.xw-toasts > div { display: flex; flex-direction: column; align-items: center; gap: var(--xw-space-2); width: 100%; }
.xw-toast { pointer-events: auto; display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; max-width: 32rem; width: 100%; padding: var(--xw-space-3) var(--xw-space-2) var(--xw-space-3) var(--xw-space-4);
  background: var(--xw-surface-alt); color: var(--xw-text); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-lg); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); animation: xw-rise var(--xw-base) ease-out; }
.xw-toast--success { border-color: var(--xw-success); }
.xw-toast--error { border-color: var(--xw-danger); }
.xw-toast-msg { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.xw-toast--success .xw-toast-ic { color: var(--xw-success); }
.xw-toast--error .xw-toast-ic { color: var(--xw-danger); }
@keyframes xw-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

/* ---------- Estado vacío / Skeleton ---------- */
.xw-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--xw-space-3); padding: var(--xw-space-12) var(--xw-space-4); color: var(--xw-text-muted); font-family: var(--xw-font); }
.xw-empty-ic { color: var(--xw-accent); }
.xw-empty-title { margin: 0; color: var(--xw-text); font: ${font.weight.bold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }
.xw-empty-text { margin: 0; max-width: 32rem; font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-skeleton { display: block; background: linear-gradient(90deg, var(--xw-surface-alt) 25%, var(--xw-surface) 50%, var(--xw-surface-alt) 75%); background-size: 200% 100%; animation: xw-shimmer 1.4s ease-in-out infinite; }
@keyframes xw-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

${buildShellCss()}

${buildWelcomeCss()}

${buildAuthCss()}

${buildHomeCss()}

${buildAssistantCss()}

${buildSubscriptionCss()}

${buildProfileCss()}

${buildLoyaltyCss()}
${buildEmployeesCss()}

/* Movimiento reducido (WCAG 2.3.3). */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
  .xw-skeleton { background: var(--xw-surface-alt); }
}

/* Modo de alto contraste de Windows. */
@media (forced-colors: active) {
  .xw-btn, .xw-control, .xw-card, .xw-modal, .xw-toast { border-color: CanvasText; }
  .xw-btn--primary { background: ButtonFace; color: ButtonText; }
}
`.trim();
}

/** Inserta el CSS una sola vez por documento (idempotente). */
export function ensureStyles(doc: Document = document): void {
  if (doc.getElementById('xw-styles')) return;
  const style = doc.createElement('style');
  style.id = 'xw-styles';
  style.textContent = buildCss();
  doc.head.appendChild(style);
}

export function applyTheme(mode: ThemeName, doc: Document = document): void {
  doc.documentElement.setAttribute('data-theme', mode);
}
