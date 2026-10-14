/** CSS de "Cierre de caja": cabecera del día y el color del sobrante/faltante en el resumen. Se añade a buildCss(). */
export function buildCashCloseCss(): string {
  return `
.xw-cash-close-head { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); margin-bottom: var(--xw-space-2); }
.xw-summary-row dd.is-success { color: var(--xw-success); }
.xw-summary-row dd.is-danger { color: var(--xw-danger); }
/* Cambios después del cierre firmado (ventas nuevas o anuladas, ajustes): aviso dorado, no error. */
.xw-after-close { display: flex; gap: var(--xw-space-2); align-items: flex-start; padding: var(--xw-space-2) var(--xw-space-3); border-radius: var(--xw-radius-md); color: var(--xw-text); background: var(--xw-accent-tint); border: 1px solid color-mix(in srgb, var(--xw-accent) 40%, transparent); }
.xw-after-close svg { flex: none; margin-top: 2px; color: var(--xw-accent); }
`;
}
