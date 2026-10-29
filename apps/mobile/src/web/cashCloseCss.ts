/** CSS de "Cierre de caja": cabecera del día y el color del sobrante/faltante en el resumen. Se añade a buildCss(). */
export function buildCashCloseCss(): string {
  return `
.xw-cash-close-head { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); margin-bottom: var(--xw-space-2); }
.xw-summary-row dd.is-success { color: var(--xw-success); }
.xw-summary-row dd.is-danger { color: var(--xw-danger); }
.xw-hint.is-danger { color: var(--xw-danger); }
/* Producción por empleado: tarjetas de al menos ~17rem que se acomodan al ancho real del panel (1, 2, 3… columnas). */
.xw-cash-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: var(--xw-space-4); align-items: stretch; }
.xw-cash-card { display: flex; flex-direction: column; gap: var(--xw-space-2); min-width: 0; }
.xw-cash-card .xw-panel-title { overflow-wrap: break-word; }
/* "Ver más" siempre al pie de la tarjeta, alineado entre tarjetas de distinta altura. */
.xw-cash-card-action { margin-top: auto; padding-top: var(--xw-space-2); }
/* En la tarjeta (columna flex) la barra de proporción no debe crecer en alto: tamaño fijo. */
.xw-cash-card > .xw-cash-share { flex: none; width: 100%; height: 6px; margin: 0; }
/* Líneas de servicio/producto: nombre (se ajusta entre palabras) + neto a la derecha; detalle bruto/descuento debajo. */
.xw-cash-lines { list-style: none; margin: 0; padding: 0; }
.xw-cash-lines li { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--xw-space-3); row-gap: 2px; align-items: baseline; padding: var(--xw-space-2) 0; border-bottom: 1px solid var(--xw-border-subtle); }
.xw-cash-lines li:last-child { border-bottom: 0; }
.xw-cash-line-name { min-width: 0; overflow-wrap: break-word; word-break: normal; hyphens: auto; font: 600 var(--xw-text-sm)/1.35 var(--xw-font); color: var(--xw-text); }
.xw-cash-line-net { white-space: nowrap; text-align: right; font: 800 var(--xw-text-sm)/1.35 var(--xw-font); color: var(--xw-text); }
.xw-cash-line-detail { grid-column: 1 / -1; min-width: 0; overflow-wrap: break-word; color: var(--xw-text-muted); font: var(--xw-text-xs)/1.4 var(--xw-font); }
/* ---------- Animación de las gráficas del cierre ----------
   Entrada: cada barra crece desde abajo en cascada (--i) y su valor aparece después. Actualización automática: la altura
   y el ancho cambian con transición suave (no se reinicia la animación). Todo se apaga con "reducir movimiento". */
@keyframes xw-cash-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes xw-cash-grow-x { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes xw-cash-fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes xw-cash-glow { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--xw-accent) 0%, transparent); } 50% { box-shadow: 0 0 18px 2px color-mix(in srgb, var(--xw-accent) 35%, transparent); } }
.xw-cash-bars .xw-bar-fill { transform-origin: bottom center; animation: xw-cash-grow 760ms cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay: calc(var(--i, 0) * 28ms); transition: height 650ms cubic-bezier(0.22, 1, 0.36, 1), filter 200ms ease; will-change: transform; }
.xw-cash-bars .xw-bar-value { animation: xw-cash-fade-up 420ms ease-out both; animation-delay: calc(var(--i, 0) * 28ms + 520ms); }
.xw-cash-bars .xw-bar-label { animation: xw-cash-fade-up 360ms ease-out both; animation-delay: calc(var(--i, 0) * 18ms); }
.xw-cash-bars .xw-bar.is-peak .xw-bar-fill { animation: xw-cash-grow 760ms cubic-bezier(0.22, 1, 0.36, 1) both, xw-cash-glow 2.4s ease-in-out 1.3s 2; animation-delay: calc(var(--i, 0) * 28ms), 1.3s; }
.xw-cash-bars .xw-bar:not(.is-empty):hover .xw-bar-fill { filter: brightness(1.12) saturate(1.1); }
/* Valor de la barra en una sola línea solo cuando hay ancho de sobra; en pantallas angostas se parte (no se monta sobre la vecina). */
@container (min-width: 40rem) { .xw-cash-bars .xw-bar-value { white-space: nowrap; } }
.xw-cash-rank li { flex-wrap: wrap; }
.xw-cash-share { display: block; flex-basis: 100%; height: 6px; margin: 2px 0 0 calc(28px + var(--xw-space-3)); border-radius: var(--xw-radius-pill); background: var(--xw-border-subtle); overflow: hidden; }
.xw-panel > .xw-cash-share { margin-left: 0; margin-bottom: var(--xw-space-2); }
.xw-cash-share-fill { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--xw-accent) 55%, transparent), var(--xw-accent)); transform-origin: left center; animation: xw-cash-grow-x 820ms cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay: calc(var(--i, 0) * 90ms + 150ms); transition: width 650ms cubic-bezier(0.22, 1, 0.36, 1); }
@media (prefers-reduced-motion: reduce) {
  .xw-cash-bars .xw-bar-fill, .xw-cash-bars .xw-bar-value, .xw-cash-bars .xw-bar-label, .xw-cash-share-fill { animation: none !important; transition: none !important; }
}
/* "Ver más": tarjetas de venta/gasto del detalle (anuladas atenuadas, nunca ocultas). */
.xw-detail-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-detail-card { border: 1px solid var(--xw-border); border-radius: var(--xw-radius-md); padding: var(--xw-space-3); display: flex; flex-direction: column; gap: var(--xw-space-1); }
.xw-detail-card.is-voided { opacity: 0.75; border-style: dashed; }
.xw-detail-card p { margin: 0; }
.xw-detail-head { display: flex; justify-content: space-between; align-items: center; gap: var(--xw-space-2); flex-wrap: wrap; }
.xw-detail-other { margin: 0; padding-left: var(--xw-space-4); }
.xw-detail-group { margin-top: var(--xw-space-4); }
.xw-detail-more { display: flex; align-items: center; gap: var(--xw-space-3); margin-top: var(--xw-space-3); flex-wrap: wrap; }
/* Estado de la actualización automática del día (hora, pausa, error con reintento). */
.xw-cash-close-head + .xw-hint { display: flex; align-items: center; flex-wrap: wrap; gap: var(--xw-space-2); }
/* Cambios después del cierre firmado (ventas nuevas o anuladas, ajustes): aviso dorado, no error. */
.xw-after-close { display: flex; gap: var(--xw-space-2); align-items: flex-start; padding: var(--xw-space-2) var(--xw-space-3); border-radius: var(--xw-radius-md); color: var(--xw-text); background: var(--xw-accent-tint); border: 1px solid color-mix(in srgb, var(--xw-accent) 40%, transparent); }
.xw-after-close svg { flex: none; margin-top: 2px; color: var(--xw-accent); }
`;
}
