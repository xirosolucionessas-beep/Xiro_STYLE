import { font } from './tokens';

/**
 * Aviso de vencimiento/vencida (sección 4). z-index por encima del panel del asistente a propósito: si la
 * suscripción vence mientras el negocio está usando otra cosa, este aviso debe ganar siempre. Se añade a buildCss().
 */
export function buildSubscriptionCss(): string {
  return `
.xw-subgate-root { position: fixed; inset: 0; z-index: 9600; }
.xw-subgate-scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, .75); }
.xw-subgate { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1; box-sizing: border-box;
  width: calc(100% - var(--xw-space-6) * 2); max-width: 24rem; max-height: calc(100vh - var(--xw-space-6) * 2); overflow-y: auto;
  display: flex; flex-direction: column; align-items: center; text-align: center; padding: var(--xw-space-8) var(--xw-space-6);
  background: #141210; border: 1px solid var(--xw-accent); border-radius: var(--xw-radius-xl); box-shadow: 0 30px 70px -20px rgba(0, 0, 0, .7);
  animation: xw-subgate-in var(--xw-base) ease-out; }
.xw-subgate:focus { outline: none; }
@keyframes xw-subgate-in { from { opacity: 0; transform: translate(-50%, -46%); } to { opacity: 1; transform: translate(-50%, -50%); } }
.xw-subgate-close { position: absolute; top: var(--xw-space-3); right: var(--xw-space-3); display: flex; align-items: center; justify-content: center;
  width: var(--xw-touch); height: var(--xw-touch); background: transparent; border: 0; border-radius: 50%; color: #9c9689; cursor: pointer; }
.xw-subgate-close:hover { background: rgba(255, 255, 255, .08); }
.xw-subgate-icon { position: relative; display: flex; align-items: center; justify-content: center; width: 4rem; height: 4rem;
  border-radius: 50%; background: var(--xw-accent-tint); border: 1px solid var(--xw-accent); color: var(--xw-accent); }
.xw-subgate-icon-badge { position: absolute; right: -2px; bottom: -2px; display: flex; align-items: center; justify-content: center;
  width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--xw-accent); color: var(--xw-on-accent); border: 2px solid #141210; }
.xw-subgate-title { margin: var(--xw-space-5) 0 0; color: #fff; font: ${font.weight.extrabold} var(--xw-text-xl)/${font.lineHeight.tight} var(--xw-font); }
.xw-subgate-body { margin: var(--xw-space-2) 0 var(--xw-space-6); color: #c9c3b6; font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-subgate .xw-btn { width: 100%; margin-top: var(--xw-space-3); }
.xw-subgate-logout { margin-top: var(--xw-space-4); min-height: var(--xw-touch); padding: 0 var(--xw-space-3); background: transparent; border: 0;
  color: #9c9689; font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); cursor: pointer; }
.xw-subgate-logout:hover { color: #fff; }
@media (prefers-reduced-motion: reduce) {
  .xw-subgate { animation: none !important; }
}

/* ---------- Pantalla de checkout (Web) ---------- */
/* Pantalla completa (standalone, sin sidebar): puede usar un contenedor más ancho que un form normal — max-w-5xl. */
.xw-page.xw-sub-page { max-width: 72rem; position: relative; padding-top: var(--xw-space-8); padding-bottom: var(--xw-space-12); }
/* Pantalla completa sin la estructura de Screen: el propio <main> hace scroll (rueda, trackpad y teclado, porque recibe el foco
   al entrar). Sin esto, en pantallas de poca altura (portátil 1366×768) se cortaba el resumen, el botón de pagar y las notas. */
.xw-main[data-standalone='true'] { overflow-y: auto; overflow-x: hidden; }
[data-mode='mobile'] .xw-sub-page { padding-top: var(--xw-space-6); }
.xw-sub-close { position: absolute; top: var(--xw-space-2); right: var(--xw-space-2); display: flex; align-items: center; justify-content: center;
  width: var(--xw-touch); height: var(--xw-touch); background: transparent; border: 0; border-radius: 50%; color: var(--xw-text-muted); cursor: pointer; }
.xw-sub-close:hover { background: var(--xw-surface-tint); color: var(--xw-text); }
.xw-co { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--xw-space-6); align-items: start; }
@media (min-width: 900px) {
  .xw-co { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: var(--xw-space-8); }
  /* El panel de beneficios se queda a la vista mientras se desplaza el pago; si NO cabe en el alto, tiene su propio scroll. */
  .xw-co-aside { position: sticky; top: var(--xw-space-4); max-height: calc(100vh - var(--xw-space-16)); max-height: calc(100dvh - var(--xw-space-16)); overflow-y: auto; overscroll-behavior: contain; }
}
.xw-co-aside { display: flex; flex-direction: column; align-items: flex-start; gap: var(--xw-space-4); box-sizing: border-box; padding: var(--xw-space-8); border-radius: var(--xw-radius-xl); color: var(--xw-text); border: 1px solid var(--xw-border-subtle);
  background: radial-gradient(90% 120% at 100% 0%, rgba(217, 182, 54, .28), transparent 55%), linear-gradient(135deg, #17140a 0%, #0d0d0f 70%); }
.xw-co-logo { display: block; width: 56px; height: 56px; border-radius: var(--xw-radius-lg); overflow: hidden; border: 2px solid rgba(217, 182, 54, .6); }
.xw-co-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-3xl)/${font.lineHeight.tight} var(--xw-font); }
.xw-co-sub { margin: 0; color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-co-benefits { list-style: none; margin: var(--xw-space-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-co-benefits li { display: flex; align-items: center; gap: var(--xw-space-3); font: ${font.weight.semibold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-co-benefit-ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: var(--xw-radius-md); background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-co-trust { display: flex; align-items: flex-start; gap: var(--xw-space-2); margin: var(--xw-space-2) 0 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-co-trust svg { flex: none; margin-top: 2px; color: var(--xw-accent); }
.xw-co-main { display: flex; flex-direction: column; gap: var(--xw-space-6); min-width: 0; }
.xw-co-step-title { display: flex; align-items: center; gap: var(--xw-space-3); margin: 0 0 var(--xw-space-3); font: ${font.weight.extrabold} var(--xw-text-lg)/${font.lineHeight.tight} var(--xw-font); }
.xw-co-step-n { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--xw-accent); color: var(--xw-on-accent); font: ${font.weight.extrabold} var(--xw-text-sm)/1 var(--xw-font); }
.xw-co-summary { box-sizing: border-box; padding: var(--xw-space-5); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-xl); }
.xw-co-summary .xw-summary { margin-bottom: var(--xw-space-4); }
[data-mode='mobile'] .xw-co-aside { padding: var(--xw-space-5); }
[data-mode='mobile'] .xw-co-title { font-size: var(--xw-text-2xl); }
/* En móvil el plan y el pago van primero: los beneficios se resumen (título y subtítulo) para no empujarlos fuera de pantalla. */
[data-mode='mobile'] .xw-co-benefits, [data-mode='mobile'] .xw-co-trust { display: none; }

.xw-plans-grid { display: grid; grid-template-columns: 1fr; gap: var(--xw-space-4); }
@media (min-width: 480px) { .xw-plans-grid { grid-template-columns: 1fr 1fr; } }
.xw-plan-card { position: relative; box-sizing: border-box; width: 100%; padding: var(--xw-space-5); border: 2px solid var(--xw-border-subtle); border-radius: var(--xw-radius-xl);
  background: var(--xw-surface); color: var(--xw-text); cursor: pointer; text-align: left; font-family: var(--xw-font);
  box-shadow: 0 12px 30px -18px rgba(0, 0, 0, .5); transition: border-color var(--xw-fast), background-color var(--xw-fast), box-shadow var(--xw-fast), transform var(--xw-fast); }
.xw-plan-card:hover { border-color: var(--xw-border); transform: translateY(-2px); box-shadow: 0 18px 38px -18px rgba(0, 0, 0, .55); }
.xw-plan-card.is-selected { border-color: var(--xw-accent); background: var(--xw-accent-tint);
  box-shadow: 0 20px 44px -20px color-mix(in srgb, var(--xw-accent) 55%, transparent); }
.xw-plan-card-top { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-2); margin-bottom: var(--xw-space-2); }
.xw-plan-badge { padding: 2px var(--xw-space-2); border-radius: var(--xw-radius-pill); background: var(--xw-accent); color: var(--xw-on-accent); font: ${font.weight.bold} var(--xw-text-xs)/1.5 var(--xw-font); white-space: nowrap; }
.xw-plan-price { color: var(--xw-text); font: ${font.weight.extrabold} var(--xw-text-2xl)/1.15 var(--xw-font); }
.xw-plan-period { color: var(--xw-text-muted); font: var(--xw-text-sm)/1 var(--xw-font); }
.xw-plan-trial { margin-top: var(--xw-space-2); color: var(--xw-accent); font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }

.xw-pay-methods { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--xw-space-3); }
[data-mode='mobile'] .xw-pay-methods { grid-template-columns: 1fr; gap: var(--xw-space-3); }
.xw-pay-method { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--xw-space-3); box-sizing: border-box; min-height: 8rem;
  padding: var(--xw-space-5) var(--xw-space-4); border-radius: var(--xw-radius-xl); border: 2px solid color-mix(in srgb, var(--xw-accent) 20%, var(--xw-border-subtle)); background: var(--xw-surface); color: var(--xw-text-muted);
  cursor: pointer; font: ${font.weight.bold} var(--xw-text-md)/1 var(--xw-font); box-shadow: 0 10px 26px -16px rgba(0, 0, 0, .55); transition: border-color var(--xw-fast), background-color var(--xw-fast), box-shadow var(--xw-fast), transform var(--xw-fast); }
[data-mode='mobile'] .xw-pay-method { flex-direction: row; justify-content: flex-start; min-height: calc(var(--xw-touch) + var(--xw-space-2)); text-align: left; }
.xw-pay-method:hover { border-color: var(--xw-accent); transform: translateY(-2px); box-shadow: 0 16px 34px -18px rgba(0, 0, 0, .6); }
.xw-pay-method.is-selected { border-color: var(--xw-accent); color: var(--xw-accent); background: var(--xw-accent-tint);
  box-shadow: 0 18px 40px -18px color-mix(in srgb, var(--xw-accent) 55%, transparent); }
.xw-pay-method[aria-disabled='true'] { opacity: .45; cursor: not-allowed; }
.xw-pay-method-ico { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 3.25rem; height: 3.25rem; border-radius: var(--xw-radius-lg);
  background: var(--xw-surface-tint); border: 1px solid color-mix(in srgb, var(--xw-accent) 25%, transparent); color: inherit; }
[data-mode='mobile'] .xw-pay-method-ico { width: 2.75rem; height: 2.75rem; }
.xw-pay-method.is-selected .xw-pay-method-ico { background: color-mix(in srgb, var(--xw-accent) 20%, transparent); border-color: var(--xw-accent); }
.xw-pay-method-text { display: flex; flex-direction: column; align-items: center; gap: 2px; }
[data-mode='mobile'] .xw-pay-method-text { align-items: flex-start; }
.xw-pay-method-label { font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-pay-method-hint { color: var(--xw-text-muted); font: ${font.weight.medium} var(--xw-text-xs)/${font.lineHeight.tight} var(--xw-font); }
.xw-pay-method.is-selected .xw-pay-method-hint { color: color-mix(in srgb, var(--xw-accent) 80%, var(--xw-text-muted)); }
.xw-pay-mini-badges { display: flex; align-items: center; }
.xw-pay-mini-badges > *:not(:first-child) { margin-left: -6px; }
.xw-pay-mini-badges span { border-radius: 50%; box-shadow: 0 0 0 2px var(--xw-surface); }
.xw-pay-method.is-selected .xw-pay-mini-badges span { box-shadow: 0 0 0 2px var(--xw-accent-tint); }

.xw-bank-note { box-sizing: border-box; padding: var(--xw-space-4); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-md);
  background: var(--xw-surface-tint); color: var(--xw-text); white-space: pre-wrap; overflow-wrap: anywhere; margin-top: var(--xw-space-4);
  font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
`.trim();
}
