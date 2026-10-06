/** CSS de "Cierre de caja": cabecera del día y el color del sobrante/faltante en el resumen. Se añade a buildCss(). */
export function buildCashCloseCss(): string {
  return `
.xw-cash-close-head { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); margin-bottom: var(--xw-space-2); }
.xw-summary-row dd.is-success { color: var(--xw-success); }
.xw-summary-row dd.is-danger { color: var(--xw-danger); }
`;
}
