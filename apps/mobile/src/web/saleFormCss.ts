import { font } from './tokens';

/** CSS de "Registrar venta" (POS): cliente, catálogo, carrito y pago. Se añade a buildCss(). */
export function buildSaleFormCss(): string {
  return `
.xw-sale { display: flex; flex-direction: column; gap: var(--xw-space-4); padding-bottom: var(--xw-space-8); }

/* ---------- Cliente ---------- */
.xw-sale-client-picked { display: flex; align-items: center; gap: var(--xw-space-3); }
.xw-sale-client-actions { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); margin-top: var(--xw-space-3); }
.xw-sale-inline-form { display: flex; flex-direction: column; gap: 0; margin-top: var(--xw-space-3); padding: var(--xw-space-4); background: var(--xw-surface-alt); border-radius: var(--xw-radius-md); }
.xw-sale-inline-actions { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); }
.xw-sale-client-results { list-style: none; margin: var(--xw-space-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--xw-space-1); max-height: 16rem; overflow-y: auto; }
.xw-sale-client-row { display: flex; align-items: center; gap: var(--xw-space-3); width: 100%; box-sizing: border-box; min-height: var(--xw-touch); padding: var(--xw-space-2); background: none; border: 0; border-radius: var(--xw-radius-md); color: var(--xw-text); text-align: left; cursor: pointer; font-family: var(--xw-font); }
.xw-sale-client-row:hover { background: var(--xw-surface-alt); }
.xw-sale-appt-hint { display: flex; align-items: center; gap: var(--xw-space-3); margin-top: var(--xw-space-3); padding: var(--xw-space-3); background: var(--xw-accent-tint); color: var(--xw-accent); border-radius: var(--xw-radius-md); }
.xw-sale-appt-hint .xw-cell-sub { color: inherit; opacity: .85; }

/* ---------- Pestañas servicio/producto ---------- */
.xw-sale-tabs { display: inline-flex; gap: var(--xw-space-1); padding: 3px; margin-bottom: var(--xw-space-3); background: var(--xw-surface-alt); border-radius: var(--xw-radius-pill); }
.xw-sale-tab { box-sizing: border-box; min-height: calc(var(--xw-touch) - 8px); padding: 0 var(--xw-space-4); background: none; border: 0; border-radius: var(--xw-radius-pill); color: var(--xw-text-muted); font: ${font.weight.bold} var(--xw-text-sm)/1 var(--xw-font); cursor: pointer; }
.xw-sale-tab.is-active { background: var(--xw-accent); color: var(--xw-on-accent); }

/* ---------- Catálogo de la venta ---------- */
/* Con un catálogo largo, esta lista (no la página completa) es la que se desplaza: así las pestañas, el buscador y el
   carrito de abajo quedan siempre a la vista, en vez de empujarse fuera de pantalla. max-height ≈ 7 filas visibles. */
.xw-sale-catalog { list-style: none; margin: var(--xw-space-3) 0 0; padding: 0 var(--xw-space-1) 0 0; display: flex; flex-direction: column; gap: var(--xw-space-1); max-height: 24rem; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--xw-border) transparent; }
.xw-sale-catalog::-webkit-scrollbar { width: 6px; }
.xw-sale-catalog::-webkit-scrollbar-track { background: transparent; }
.xw-sale-catalog::-webkit-scrollbar-thumb { background: var(--xw-border); border-radius: var(--xw-radius-pill); }
/* position: relative: esta misma clase la reutiliza el historial de Cierre de caja con un <a class="xw-cell-title"> real dentro (ver
   pagesCss.ts) — sin esto, el enlace estirado de esa fila escaparía a cubrir toda la página, igual que el bug que tenían estas filas. */
.xw-sale-catalog-row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); box-sizing: border-box; min-height: var(--xw-touch); padding: var(--xw-space-2); border-radius: var(--xw-radius-md); }
.xw-sale-catalog-row:hover { background: var(--xw-surface-alt); }
.xw-sale-manual-toggle { display: inline-flex; align-items: center; gap: var(--xw-space-2); margin-top: var(--xw-space-3); padding: var(--xw-space-2) 0; background: none; border: 0; color: var(--xw-accent); font: ${font.weight.bold} var(--xw-text-sm)/1 var(--xw-font); cursor: pointer; }
.xw-sale-check { display: flex; align-items: center; gap: var(--xw-space-2); margin: var(--xw-space-2) 0 var(--xw-space-4); color: var(--xw-text); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-sale-check input { width: 18px; height: 18px; accent-color: var(--xw-accent); }

/* ---------- Carrito ---------- */
.xw-sale-cart { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--xw-space-4); }
.xw-sale-cart-row { padding: var(--xw-space-3); background: var(--xw-surface-alt); border-radius: var(--xw-radius-md); }
.xw-sale-cart-top { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); margin-bottom: var(--xw-space-2); }
.xw-sale-cart-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--xw-space-4); }
.xw-sale-cart-controls .xw-field { margin-bottom: 0; min-width: 9rem; }
.xw-sale-stepper { display: inline-flex; align-items: center; gap: var(--xw-space-2); box-sizing: border-box; min-height: var(--xw-touch); padding: 0 var(--xw-space-2); background: var(--xw-surface); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-md); }
.xw-sale-stepper span { min-width: 1.5rem; text-align: center; font: ${font.weight.extrabold} var(--xw-text-md)/1 var(--xw-font); }
.xw-sale-cart-price { align-self: center; font: ${font.weight.bold} var(--xw-text-md)/1 var(--xw-font); }
.xw-sale-cart-total { margin: var(--xw-space-2) 0 0; text-align: right; color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-md)/1 var(--xw-font); }

/* ---------- Descuento, propina y pago ---------- */
.xw-sale-discount-row { display: flex; flex-wrap: wrap; gap: var(--xw-space-4); margin-bottom: var(--xw-space-2); }
.xw-sale-discount-row .xw-field { flex: 1 1 12rem; margin-bottom: 0; }
.xw-sale-payments { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-sale-payment-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--xw-space-3); padding-bottom: var(--xw-space-3); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-sale-payment-row:last-child { border-bottom: 0; padding-bottom: 0; }
.xw-sale-payment-row .xw-field { flex: 1 1 9rem; margin-bottom: 0; }
/* Las 5 formas de pago en píldoras ya ocupan bastante ancho: van en su propia línea, con el monto (y el recibido en
   efectivo) debajo en vez de apretarse a su lado. */
.xw-sale-payment-row .xw-rg { flex: 1 1 100%; }

/* ---------- Resumen y envío ---------- */
.xw-sale-summary { padding: var(--xw-space-5); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); }
.xw-summary-row--total { border-bottom: 0; margin-top: var(--xw-space-1); padding-top: var(--xw-space-3); border-top: 2px solid var(--xw-border); }
.xw-summary-row--total dt { color: var(--xw-text); font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-summary-row--total dd { color: var(--xw-accent); font: ${font.weight.extrabold} var(--xw-text-xl)/${font.lineHeight.tight} var(--xw-font); }
.xw-sale-actions { display: flex; flex-wrap: wrap; gap: var(--xw-space-3); margin-top: var(--xw-space-4); }
.xw-sale-actions .xw-btn--block { flex: 1 1 12rem; }

/* ---------- Confirmación ---------- */
/* width: 100% además de max-width: como elemento flex (ver .xw-section) dentro de los View de React Native Web que arma
   el shell, "margin: 0 auto" por sí solo no bastaba para resolver un ancho — el navegador lo calculaba en 0 y cada
   palabra del recibo caía en su propia línea. Con un ancho explícito, max-width lo limita y el margen automático lo
   centra, tal como en un bloque normal. */
.xw-sale-done { width: 100%; max-width: 28rem; margin: 0 auto; text-align: center; }
.xw-sale-done .xw-summary { text-align: left; margin: var(--xw-space-4) 0; }
/* Confirmación de venta: el check "aparece" con un rebote corto (≈0.5s) en vez de simplemente estar ahí; el confeti
 * (reutiliza .xw-celebrate-dot de la celebración del plan) cae y se desvanece en ≈1.2s. El freno global de movimiento
 * reducido (styles.ts) ya los dejar casi instantáneos cuando el sistema lo pide — nada que repetir aquí. */
.xw-sale-done-icon { position: relative; animation: xw-sale-check-pop .5s cubic-bezier(.34, 1.56, .64, 1) both; }
@keyframes xw-sale-check-pop { 0% { opacity: 0; transform: scale(.4) rotate(-8deg); } 60% { opacity: 1; transform: scale(1.12) rotate(2deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
.xw-sale-done-icon .xw-celebrate-confetti { inset: -10px -50px auto; height: 70px; }

@media print {
  /* Respaldo de Ctrl+P (el botón "Imprimir" usa un ticket propio, ver web/services/print.ts). La maquetación de la app tiene
     alturas fijas y desplazamiento interno: se liberan para que nada quede recortado, y solo el comprobante se ve. */
  html, body, #root, #root * { height: auto !important; max-height: none !important; overflow: visible !important; position: static !important; }
  body * { visibility: hidden; }
  #xw-sale-receipt, #xw-sale-receipt * { visibility: visible; }
  #xw-sale-receipt { position: absolute !important; top: 0; left: 0; width: 72mm; margin: 0; color: #000; background: #fff; font-size: 12pt; }
}
`;
}
